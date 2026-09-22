import type { ImportedPlaceItem, PlaceCatalogEntry } from '@/types/domain/placeCatalog';

export interface PlaceCatalogRepository {
  isEnabled(categoryId: string): Promise<boolean>;
  search(categoryId: string, query: string, signal?: AbortSignal): Promise<PlaceCatalogEntry[]>;
  select(categoryId: string, catalogId: string): Promise<ImportedPlaceItem>;
}
