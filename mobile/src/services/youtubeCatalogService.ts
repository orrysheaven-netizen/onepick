import { AppError } from '@/errors/appError';
import { parseYouTubeVideoUrl } from '@/lib/youtube/videoLink';
import type { YouTubeCatalogRepository } from '@/repositories/interfaces/youtubeCatalogRepository';

export class YouTubeCatalogService {
  constructor(private readonly repository: YouTubeCatalogRepository) {}

  search(query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    return cleanQuery.length >= 2 && cleanQuery.length <= 1000
      ? this.repository.search(cleanQuery, signal)
      : Promise.resolve([]);
  }

  importChannel(externalId: string) {
    return this.repository.importChannel(externalId.trim());
  }

  /** Only a link that parses as a YouTube video reaches the Edge Function (and its quota). */
  lookupVideo(url: string, signal?: AbortSignal) {
    const cleanUrl = url.trim();
    return parseYouTubeVideoUrl(cleanUrl)
      ? this.repository.lookupVideo(cleanUrl, signal)
      : Promise.reject(new AppError('VIDEO_URL_INVALID'));
  }

  importVideo(externalId: string, categoryId: string) {
    return this.repository.importVideo(externalId.trim(), categoryId.trim());
  }
}
