import type { PickPhotoDraft } from '@/types/domain/photo';

export interface PhotoRepository {
  upload(userId: string, photo: PickPhotoDraft): Promise<{ imagePath: string; thumbnailPath: string }>;
  importFromUrl(url: string): Promise<{ dataUri: string; sourceUrl: string }>;
  removeUnused(paths: string[]): Promise<void>;
  cleanupUnused(userId: string): Promise<void>;
}
