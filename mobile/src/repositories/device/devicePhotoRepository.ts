import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { AppError } from '@/errors/appError';
import type { PickPhotoDraft } from '@/types/domain/photo';

const FULL_PHOTO_MAX_SIDE = 1200;
const THUMBNAIL_MAX_SIDE = 320;
const JPEG_QUALITY = 0.82;

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

      // Large source dimensions are normalized for display/egress, but byte size
      // is never a rejection reason. Storage's project-wide limit remains the
      // infrastructure ceiling.
      const full = await this.optimize(uri, original.width, original.height, FULL_PHOTO_MAX_SIDE);
      const thumbnail = await this.optimize(full.uri, full.width, full.height, THUMBNAIL_MAX_SIDE);

      return {
        uri: full.uri,
        base64: full.base64!,
        thumbnailBase64: thumbnail.base64!,
        sourceUrl,
        uploadId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('PHOTO_INVALID', 'PHOTO_INVALID', error);
    } finally {
      original?.release();
      context.release();
    }
  }

  private async optimize(
    uri: string,
    width: number,
    height: number,
    maxSide: number,
  ) {
    const sourceMaxSide = Math.max(width, height);
    const targetSide = Math.min(sourceMaxSide, maxSide);
    const context = ImageManipulator.manipulate(uri);
    let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      if (sourceMaxSide > targetSide) {
        context.resize(width >= height ? { width: targetSide } : { height: targetSide });
      }
      image = await context.renderAsync();
      const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
      if (!result.base64) throw new AppError('PHOTO_INVALID');
      return result;
    } finally {
      image?.release();
      context.release();
    }
  }
}
