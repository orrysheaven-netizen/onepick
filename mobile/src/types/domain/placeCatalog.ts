export interface PlaceCatalogEntry {
  catalogId: string;
  source: string;
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
}

export interface ImportedPlaceItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
