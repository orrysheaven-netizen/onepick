import type { MusicCatalogRepository } from '@/repositories/interfaces/musicCatalogRepository';

export class MusicCatalogService {
  constructor(private readonly repository: MusicCatalogRepository) {}

  search(title: string, artist = '', signal?: AbortSignal) {
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    const cleanArtist = artist.trim().replace(/\s+/g, ' ');
    const valid = cleanTitle.length >= 1 && cleanTitle.length <= 100
      && cleanArtist.length <= 100
      && (cleanTitle.length >= 2 || cleanArtist.length >= 2);
    return valid ? this.repository.search(cleanTitle, cleanArtist, signal) : Promise.resolve([]);
  }

  importRecording(externalId: string) {
    return this.repository.importRecording(externalId);
  }
}
