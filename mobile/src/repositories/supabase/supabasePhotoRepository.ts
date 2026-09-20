import { decode } from 'base64-arraybuffer';
import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PhotoRepository } from '@/repositories/interfaces/photoRepository';
import { MAX_PICK_PHOTO_BYTES, MAX_THUMBNAIL_BYTES, type PickPhotoDraft } from '@/types/domain/photo';

export class SupabasePhotoRepository implements PhotoRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async importFromUrl(url: string) {
    const { data, error } = await this.client.functions.invoke('import-item-image', { body: { url } });
    if (error) {
      // FunctionsHttpError exposes the structured response without logging user URLs.
      const context = 'context' in error ? error.context : undefined;
      const body = context instanceof Response ? await context.json().catch(() => null) : null;
      throw body?.error ? mapSupabaseError({ message: body.error }) : new AppError('IMAGE_IMPORT_FAILED');
    }
    if (typeof data?.dataUri !== 'string' || typeof data?.sourceUrl !== 'string') throw new AppError('IMAGE_IMPORT_FAILED');
    return { dataUri: data.dataUri as string, sourceUrl: data.sourceUrl as string };
  }

  async upload(userId: string, photo: PickPhotoDraft) {
    const full = decode(photo.base64), thumb = decode(photo.thumbnailBase64);
    if (!full.byteLength || !thumb.byteLength) throw new AppError('PHOTO_REQUIRED');
    if (full.byteLength > MAX_PICK_PHOTO_BYTES || thumb.byteLength > MAX_THUMBNAIL_BYTES) throw new AppError('PHOTO_TOO_LARGE');
    const imagePath = `${userId}/${photo.uploadId}.jpg`, thumbnailPath = `${userId}/${photo.uploadId}-thumb.jpg`;
    for (const [path, bytes] of [[imagePath, full], [thumbnailPath, thumb]] as const) {
      const { error } = await this.client.storage.from('item-photos').upload(path, bytes, {
        contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
      });
      // Both current and legacy Storage APIs report immutable-path retries as duplicates.
      const duplicate = error && (Number(error.statusCode) === 409 ||
        (Number(error.statusCode) === 400 && /^(?:The resource already exists|Asset Already Exists)$/i.test(error.message)));
      if (error && !duplicate) {
        const status = Number(error.statusCode);
        const message = String(error.message ?? '');
        if (status === 413) throw new AppError('PHOTO_TOO_LARGE', 'PHOTO_TOO_LARGE', error);
        if (status === 401 || status === 403 || /row-level security|permission|unauthori[sz]ed|forbidden/i.test(message)) {
          throw new AppError('FORBIDDEN', 'FORBIDDEN', error);
        }
        if (status === 429) throw new AppError('RATE_LIMITED', 'RATE_LIMITED', error);
        if (!status || /failed to fetch|network request failed|network error|fetch failed|offline/i.test(message)) {
          throw new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
        }
        throw new AppError('PHOTO_UPLOAD_FAILED', 'PHOTO_UPLOAD_FAILED', error);
      }
    }
    return { imagePath, thumbnailPath };
  }

  async removeUnused(paths: string[]) {
    // RLS protects any object already referenced by a shared item.
    if (paths.length) await this.client.storage.from('item-photos').remove(paths);
  }

  async cleanupUnused(userId: string) {
    const { data, error } = await this.client.storage.from('item-photos').list(userId, {
      limit: 100, sortBy: { column: 'created_at', order: 'asc' },
    });
    if (error || !data) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const paths = data.filter((item) => item.created_at && Date.parse(item.created_at) < cutoff).map((item) => `${userId}/${item.name}`);
    await this.removeUnused(paths);
  }
}
