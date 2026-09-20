import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { AppError } from '@/errors/appError';
import { MAX_PICK_PHOTO_BYTES, MAX_THUMBNAIL_BYTES, type PickPhotoDraft } from '@/types/domain/photo';

const FULL_PHOTO_MAX_SIDE = 1200;
const FULL_PHOTO_MIN_SIDE = 480;
const THUMBNAIL_MAX_SIDE = 320;
const THUMBNAIL_MIN_SIDE = 160;
const COMPRESSION_LEVELS = [0.82, 0.68, 0.54, 0.4, 0.3] as const;

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

      // Source pixel dimensions are never a rejection reason. We first create the
      // normal app-sized image, then automatically reduce dimensions further only
      // when the encoded JPEG would exceed the upload byte budget.
      const full = await this.optimize(
        uri,
        original.width,
        original.height,
        FULL_PHOTO_MAX_SIDE,
        FULL_PHOTO_MIN_SIDE,
        MAX_PICK_PHOTO_BYTES,
      );
      const thumbnail = await this.optimize(
        full.uri,
        full.width,
        full.height,
        THUMBNAIL_MAX_SIDE,
        THUMBNAIL_MIN_SIDE,
        MAX_THUMBNAIL_BYTES,
      );

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
    minSide: number,
    maxBytes: number,
  ) {
    const sourceMaxSide = Math.max(width, height);
    let targetSide = Math.min(sourceMaxSide, maxSide);
    const floorSide = Math.min(targetSide, minSide);

    while (true) {
      const context = ImageManipulator.manipulate(uri);
      let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        if (sourceMaxSide > targetSide) {
          context.resize(width >= height ? { width: targetSide } : { height: targetSide });
        }
        image = await context.renderAsync();

        for (const compress of COMPRESSION_LEVELS) {
          const result = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
          if (result.base64 && result.base64.length * 0.75 <= maxBytes) return result;
        }
      } finally {
        image?.release();
        context.release();
      }

      if (targetSide <= floorSide) break;
      const nextSide = Math.max(floorSide, Math.floor(targetSide * 0.75));
      if (nextSide === targetSide) break;
      targetSide = nextSide;
    }

    throw new AppError('PHOTO_TOO_LARGE');
  }
}
