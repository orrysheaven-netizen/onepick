export interface PlaceCatalogEntry {
  id: string;
  placeProvider: string;
  providerPlaceId: string;
  name: string;
  branchName: string | null;
  roadAddress: string | null;
  address: string | null;
  region1: string | null;
  region2: string | null;
  latitude: number | null;
  longitude: number | null;
  providerCategory: string | null;
  existingItemId: string | null;
}

export interface ImportedPlaceItem {
  itemId: string;
  categoryId: string;
}
