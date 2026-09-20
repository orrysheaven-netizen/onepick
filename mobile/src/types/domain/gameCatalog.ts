export interface GameCatalogEntry {
  source: 'igdb_game';
  externalId: string;
  title: string;
  developerName: string | null;
  platformNames: string[];
  releaseYear: number | null;
  coverUrl: string | null;
  igdbUrl: string | null;
  gameType: string | null;
  existingItemId: string | null;
}

export interface ImportedGameItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
