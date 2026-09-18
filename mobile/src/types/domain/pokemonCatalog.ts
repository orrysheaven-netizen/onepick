export interface PokemonCatalogEntry {
  source: 'pokeapi_species';
  externalId: string;
  name: string;
  englishName: string;
  dexNumber: number;
  imageUrl: string;
  existingItemId: string | null;
}

export interface ImportedPokemonItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
