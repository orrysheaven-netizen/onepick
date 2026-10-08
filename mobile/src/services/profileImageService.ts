import { decode } from 'base64-arraybuffer';
import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { profileImagePathFromUrl, profileImagePublicUrl } from '@/lib/profile/profileImage';
import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';

const MAX_SIDE = 512;
const JPEG_QUALITY = 0.82;
const BUCKET = 'profile-images';

export type SavedProfileImage = { userId: string; profileImageUrl: string | null };

/** My profile photo (user decision 10-05): pick → 512px JPEG → own folder → set_profile_image. */
export class ProfileImageService {
  constructor(private readonly client: AppSupabaseClient) {}

  /** Returns null when the picker is cancelled. */
  async chooseAndSave(profileUserId: string, currentUrl: string | null): Promise<SavedProfileImage | null> {
    await this.assertSignedIn(profileUserId);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled) return null;
    const uri = picked.assets[0]?.uri;
    if (!uri) throw new AppError('PHOTO_INVALID');
    const base64 = await this.prepare(uri);

    const path = `${profileUserId}/${Crypto.randomUUID()}.jpg`;
    const bytes = decode(base64);
    const upload = () => this.client.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
    });
    await this.assertSignedIn(profileUserId);
    let { error: uploadError } = await upload();
    if (uploadError && Number(uploadError.statusCode) === 403
        && await this.recoverFullFolder(profileUserId, currentUrl, path)) {
      await this.assertSignedIn(profileUserId);
      ({ error: uploadError } = await upload()); // Exactly one retry, same prepared bytes.
    }
    if (uploadError) {
      if (Number(uploadError.statusCode) === 413) throw new AppError('PHOTO_TOO_LARGE', 'PHOTO_TOO_LARGE', uploadError);
      throw new AppError('PHOTO_UPLOAD_FAILED', 'PHOTO_UPLOAD_FAILED', uploadError);
    }
    await this.assertSignedIn(profileUserId);
    const { error } = await (this.client as any).rpc('set_profile_image', { p_path: path });
    if (error) {
      // The profile still points at the old photo; drop the orphan upload.
      await this.client.storage.from(BUCKET).remove([path]).catch(() => undefined);
      throw mapSupabaseError(error);
    }
    await this.removeOld(currentUrl);
    return { userId: profileUserId, profileImageUrl: profileImagePublicUrl(path) };
  }

  async clear(profileUserId: string, currentUrl: string | null): Promise<SavedProfileImage> {
    await this.assertSignedIn(profileUserId);
    const { error } = await (this.client as any).rpc('set_profile_image', { p_path: null });
    if (error) throw mapSupabaseError(error);
    await this.removeOld(currentUrl);
    return { userId: profileUserId, profileImageUrl: null };
  }

  /** Only recover a full own folder after an RLS upload denial. DB DELETE
   * serialization is authoritative if the current photo changes after listing. */
  private async recoverFullFolder(userId: string, currentUrl: string | null, pendingPath: string) {
    await this.assertSignedIn(userId);
    const { data: objects, error: listError } = await this.client.storage.from(BUCKET)
      .list(userId, { limit: 20, offset: 0, sortBy: { column: 'created_at', order: 'asc' } });
    if (listError || !objects || objects.length < 20) return false;

    const { data: profile, error: profileError } = await this.client.from('profiles')
      .select('profile_image_url').eq('id', userId).single();
    if (profileError || !profile) return false;
    const previousPath = profileImagePathFromUrl(currentUrl);
    const candidates = objects
      .filter((object) => object.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(object.name))
      .map((object) => `${userId}/${object.name}`)
      .filter((path) => path !== profile.profile_image_url && path !== previousPath && path !== pendingPath);
    if (!candidates.length) return false;
    await this.assertSignedIn(userId);
    // Retain all but one unused object; freeing one slot is enough for this upload.
    // Storage RLS rechecks the actual current photo while holding the same lock as set_profile_image.
    const { data: removed, error } = await this.client.storage.from(BUCKET).remove(candidates.slice(0, 1));
    return !error && !!removed?.length;
  }

  private async assertSignedIn(profileUserId: string) {
    const { data: { user }, error } = await this.client.auth.getUser();
    if (error) throw mapSupabaseError(error);
    // A screen left open across an account switch must not edit the new account.
    if (!user || user.id !== profileUserId) throw new AppError('AUTH_REQUIRED');
  }

  private async removeOld(currentUrl: string | null) {
    const old = profileImagePathFromUrl(currentUrl);
    // Best effort: an orphaned old photo is only storage, never shown.
    if (old) await this.client.storage.from(BUCKET).remove([old]).catch(() => undefined);
  }

  private async prepare(uri: string) {
    const context = ImageManipulator.manipulate(uri);
    let probe: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    const resize = ImageManipulator.manipulate(uri);
    try {
      probe = await context.renderAsync();
      if (!probe.width || !probe.height) throw new AppError('PHOTO_INVALID');
      const side = Math.max(probe.width, probe.height);
      if (side > MAX_SIDE) resize.resize(probe.width >= probe.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
      image = await resize.renderAsync();
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
      if (!result.base64) throw new AppError('PHOTO_INVALID');
      return result.base64;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PHOTO_INVALID', 'PHOTO_INVALID', error);
    } finally {
      probe?.release();
      image?.release();
      context.release();
      resize.release();
    }
  }
}

export const profileImageService = new ProfileImageService(supabase);
