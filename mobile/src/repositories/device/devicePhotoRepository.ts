import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { AppError } from '@/errors/appError';
import { MAX_PICK_PHOTO_BYTES, MAX_THUMBNAIL_BYTES, type PickPhotoDraft } from '@/types/domain/photo';

export class DevicePhotoRepository {
  async choosePhoto(): Promise<PickPhotoDraft | null> {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset?.uri) throw new AppError('PHOTO_INVALID');
    return this.preparePhoto(asset.uri);
  }

  async preparePhoto(uri: string, sourceUrl?: string): Promise<PickPhotoDraft> {
    const context = ImageManipulator.manipulate(uri);
    let original: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      original = await context.renderAsync();
      if (!original.width || !original.height) throw new AppError('PHOTO_INVALID');
      const full = await this.resize(uri, original.width, original.height, 1200, MAX_PICK_PHOTO_BYTES);
      const thumbnail = await this.resize(full.uri, full.width, full.height, 320, MAX_THUMBNAIL_BYTES);
      return { uri: full.uri, base64: full.base64!, thumbnailBase64: thumbnail.base64!, sourceUrl,
        uploadId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PHOTO_INVALID', 'PHOTO_INVALID', error);
    } finally { original?.release(); context.release(); }
  }

  private async resize(uri: string, width: number, height: number, maxSide: number, maxBytes: number) {
    const context = ImageManipulator.manipulate(uri);
    let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      if (Math.max(width, height) > maxSide) context.resize(width >= height ? { width: maxSide } : { height: maxSide });
      image = await context.renderAsync();
      for (const compress of [0.8, 0.6, 0.4]) {
        const result = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
        if (result.base64 && result.base64.length * 0.75 <= maxBytes) return result;
      }
      throw new AppError('PHOTO_TOO_LARGE');
    } finally { image?.release(); context.release(); }
  }
}
