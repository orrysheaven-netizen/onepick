import { replaceItemPhoto } from '@/lib/admin-api';
import { supabase } from '@/lib/supabase/client';
import { DevicePhotoRepository } from '@/repositories/device/devicePhotoRepository';
import { photoRepository } from '@/repositories/supabase';
import type { PickPhotoDraft } from '@/types/domain/photo';

// Admin photo registration for items that arrived without one. It reuses the
// user upload path (same resize, same `item-photos` bucket under the admin's
// own folder) and then adopts the files through admin_replace_item_photo,
// which checks AAL2 and that both objects exist as JPEGs.
const devicePhotos = new DevicePhotoRepository();

export function itemPhotoUrl(path: string | null | undefined) {
  return path ? supabase.storage.from('item-photos').getPublicUrl(path).data.publicUrl : null;
}

export function chooseItemPhoto() {
  return devicePhotos.choosePhoto();
}

export async function importItemPhoto(url: string) {
  const image = await photoRepository.importFromUrl(url);
  return devicePhotos.preparePhoto(image.dataUri, image.sourceUrl);
}

export async function saveItemPhoto(itemId: string, photo: PickPhotoDraft) {
  const { data } = await supabase.auth.getSession();
  const adminId = data.session?.user.id;
  if (!adminId) throw new Error('관리자 로그인이 필요합니다.');

  const uploaded = await photoRepository.upload(adminId, photo);
  try {
    await replaceItemPhoto(itemId, uploaded.imagePath, uploaded.thumbnailPath, photo.sourceUrl);
  } catch (error) {
    await photoRepository.removeUnused([uploaded.imagePath, uploaded.thumbnailPath]).catch(() => {});
    throw error;
  }
  return uploaded;
}
