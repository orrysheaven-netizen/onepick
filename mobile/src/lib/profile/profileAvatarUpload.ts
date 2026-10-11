import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase/client';
import { isProfileAvatarPath, newProfileAvatarPath, PROFILE_AVATAR_BUCKET } from './profileAvatar';

// Avatars render at most 72pt; 512px covers 3x displays and stays far below the
// bucket's 512KiB limit as a JPEG.
const AVATAR_SIDE = 512;
const JPEG_QUALITY = 0.82;

export type ProfileAvatarDraft = { uri: string; base64: string };

export class ProfileAvatarError extends Error {
  constructor(message: string, readonly reason: 'invalid' | 'upload' | 'save' | 'remove') {
    super(message);
    this.name = 'ProfileAvatarError';
  }
}

/** Picks a photo and returns a centered square JPEG. Web has no crop UI, so the crop is ours. */
export async function chooseProfileAvatar(): Promise<ProfileAvatarDraft | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (result.canceled) return null;
  const uri = result.assets[0]?.uri;
  if (!uri) throw new ProfileAvatarError('사진을 불러오지 못했어요. 다른 사진을 골라주세요.', 'invalid');

  // Same two-pass shape as DevicePhotoRepository: measure, then transform in a fresh context.
  const probe = ImageManipulator.manipulate(uri);
  let width = 0, height = 0;
  try {
    const original = await probe.renderAsync();
    ({ width, height } = original);
    original.release();
  } catch {
    throw new ProfileAvatarError('사진을 불러오지 못했어요. 다른 사진을 골라주세요.', 'invalid');
  } finally {
    probe.release();
  }
  if (!width || !height) throw new ProfileAvatarError('사진을 불러오지 못했어요. 다른 사진을 골라주세요.', 'invalid');

  const side = Math.min(width, height);
  const context = ImageManipulator.manipulate(uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    if (width !== height) {
      context.crop({ originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side });
    }
    if (side > AVATAR_SIDE) context.resize({ width: AVATAR_SIDE, height: AVATAR_SIDE });
    image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
    if (!saved.base64) throw new ProfileAvatarError('사진을 변환하지 못했어요. 다른 사진을 골라주세요.', 'invalid');
    return { uri: saved.uri, base64: saved.base64 };
  } catch (error) {
    if (error instanceof ProfileAvatarError) throw error;
    throw new ProfileAvatarError('사진을 변환하지 못했어요. 다른 사진을 골라주세요.', 'invalid');
  } finally {
    image?.release();
    context.release();
  }
}

/** Uploads a new object, points the profile at it, then removes the previous photo. */
export async function saveProfileAvatar(userId: string, draft: ProfileAvatarDraft, previousPath: string | null) {
  const bucket = supabase.storage.from(PROFILE_AVATAR_BUCKET);
  // A leftover from an interrupted earlier save would count toward the 3-object cap.
  await removeLeftovers(userId, previousPath);
  const path = newProfileAvatarPath(userId);
  const { error: uploadError } = await bucket.upload(path, decode(draft.base64), {
    contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
  });
  if (uploadError) throw new ProfileAvatarError('사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.', 'upload');

  const { error: saveError } = await supabase.from('profiles').update({ profile_image_url: path }).eq('id', userId);
  if (saveError) {
    await bucket.remove([path]).catch(() => undefined);
    throw new ProfileAvatarError('프로필 사진을 저장하지 못했어요. 잠시 후 다시 시도해주세요.', 'save');
  }
  if (isProfileAvatarPath(previousPath, userId) && previousPath !== path) {
    await bucket.remove([previousPath]).catch(() => undefined);
  }
  return path;
}

/** Clears the profile photo; the old object is removed after the profile stops pointing at it. */
export async function removeProfileAvatar(userId: string, previousPath: string | null) {
  const { error } = await supabase.from('profiles').update({ profile_image_url: null }).eq('id', userId);
  if (error) throw new ProfileAvatarError('프로필 사진을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.', 'remove');
  if (isProfileAvatarPath(previousPath, userId)) {
    await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([previousPath]).catch(() => undefined);
  }
}

async function removeLeftovers(userId: string, keepPath: string | null) {
  const bucket = supabase.storage.from(PROFILE_AVATAR_BUCKET);
  const { data } = await bucket.list(userId, { limit: 20 }).catch(() => ({ data: null }));
  const stale = (data ?? [])
    .map((entry) => `${userId}/${entry.name}`)
    .filter((path) => path !== keepPath && isProfileAvatarPath(path, userId));
  // The DB keeps the photo in use; a stale path that is somehow still current is simply refused.
  if (stale.length) await bucket.remove(stale).catch(() => undefined);
}
