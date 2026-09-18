export interface MusicCatalogEntry {
  source: 'musicbrainz_recording';
  externalId: string;
  title: string;
  artistName: string;
  releaseTitle: string | null;
  releaseGroupId: string | null;
  releaseYear: number | null;
  coverArtUrl: string | null;
  disambiguation: string | null;
  existingItemId: string | null;
}

export interface ImportedMusicItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
