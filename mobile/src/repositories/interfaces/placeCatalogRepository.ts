import type { ImportedPlaceItem, PlaceCatalogEntry } from '@/types/domain/placeCatalog';

export interface PlaceCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<PlaceCatalogEntry[]>;
  selectPlace(catalogId: string, categoryId: string): Promise<ImportedPlaceItem>;
}
