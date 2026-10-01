import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { updateBrand } from '@/lib/admin-api';
import { supabase } from '@/lib/supabase/client';

// Brand logos live in the `brand-logos` bucket under `<brand id>/`. Only AAL2
// admins can write there, and brands.logo_path only accepts an uploaded object
// (supabase/migrations/20260927171208_add_brand_logos.sql).
// App surfaces render brand logos at up to 86pt; 256px is approximately 3x that size
// without shipping a 512px asset to every cold home load.
const LOGO_MAX_SIDE = 256;

export type BrandLogoDraft = { uri: string; base64: string };

export function brandLogoUrl(path: string | null | undefined) {
  return path ? supabase.storage.from('brand-logos').getPublicUrl(path).data.publicUrl : null;
}

/** PNG keeps a transparent logo background; the bucket allows 1MiB. */
export async function chooseBrandLogo(): Promise<BrandLogoDraft | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return null;
  const uri = result.assets[0]?.uri;
  if (!uri) throw new Error('이미지를 불러오지 못했습니다.');

  // Same two-pass shape as DevicePhotoRepository: measure, then resize in a fresh context.
  const probe = ImageManipulator.manipulate(uri);
  let width = 0, height = 0;
  try {
    const original = await probe.renderAsync();
    ({ width, height } = original);
    original.release();
  } finally {
    probe.release();
  }
  if (!width || !height) throw new Error('이미지를 불러오지 못했습니다.');

  const context = ImageManipulator.manipulate(uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    if (Math.max(width, height) > LOGO_MAX_SIDE) {
      context.resize(width >= height ? { width: LOGO_MAX_SIDE } : { height: LOGO_MAX_SIDE });
    }
    image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!saved.base64) throw new Error('이미지를 변환하지 못했습니다.');
    return { uri: saved.uri, base64: saved.base64 };
  } finally {
    image?.release();
    context.release();
  }
}

/** Uploads a new object, points the brand at it, then removes the previous one. */
export async function saveBrandLogo(brandId: string, logo: BrandLogoDraft, previousPath: string | null) {
  const path = `${brandId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.png`;
  const { error } = await supabase.storage.from('brand-logos').upload(path, decode(logo.base64), {
    contentType: 'image/png', cacheControl: '31536000', upsert: false,
  });
  if (error) {
    throw new Error(Number(error.statusCode) === 413 ? '로고 파일이 1MB를 넘습니다.' : '로고를 업로드하지 못했습니다.');
  }
  let updated;
  try {
    updated = await updateBrand(brandId, { logo_path: path });
  } catch (caught) {
    await supabase.storage.from('brand-logos').remove([path]).catch(() => {});
    throw caught;
  }
  if (previousPath && previousPath !== path) await supabase.storage.from('brand-logos').remove([previousPath]).catch(() => {});
  return updated;
}

export async function removeBrandLogo(brandId: string, previousPath: string) {
  const updated = await updateBrand(brandId, { logo_path: null });
  await supabase.storage.from('brand-logos').remove([previousPath]).catch(() => {});
  return updated;
}
