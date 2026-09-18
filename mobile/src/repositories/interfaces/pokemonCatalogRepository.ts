import type { ImportedPokemonItem, PokemonCatalogEntry } from '@/types/domain/pokemonCatalog';

export interface PokemonCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<PokemonCatalogEntry[]>;
  importPokemon(externalId: string): Promise<ImportedPokemonItem>;
}
