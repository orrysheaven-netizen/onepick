import type { PokemonCatalogRepository } from '@/repositories/interfaces/pokemonCatalogRepository';

export class PokemonCatalogService {
  constructor(private readonly repository: PokemonCatalogRepository) {}

  search(query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    return cleanQuery.length >= 1 && cleanQuery.length <= 100
      ? this.repository.search(cleanQuery, signal)
      : Promise.resolve([]);
  }

  importPokemon(externalId: string) {
    return this.repository.importPokemon(externalId.trim());
  }
}
