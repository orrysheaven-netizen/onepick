import type { RootCategoryScope } from '@/repositories/interfaces/readRepository';

export const queryKeys = {
  home: {
    all: ['home'] as const,
    data: (userId?: string) => ['home', userId ?? 'public'] as const,
    menuRanking: (groupCategoryId: string | null = null, channel: string | null = null) =>
      ['home', 'menu-ranking', groupCategoryId ?? 'all', channel ?? 'all-channels'] as const,
    itemRanking: (channel: string | null = null, limit = 20) =>
      ['home', 'item-ranking', channel ?? 'all-channels', limit] as const,
    dishPicks: (userId: string | undefined, categoryId: string, channel: string | null) =>
      ['home', userId ?? 'public', 'dish', categoryId, channel ?? 'all'] as const,
    myDishPicks: (userId: string, categoryId: string) => ['home', userId, 'dish', categoryId, 'mine'] as const,
    dailyQuestion: () => ['home', 'daily-question'] as const,
    participants: (userId?: string) => ['home', userId ?? 'public', 'participants'] as const,
  },
  explore: {
    all: ['explore'] as const,
    menuPickCounts: (channel: string | null = null) => ['explore', 'menu-pick-counts', channel ?? 'all-channels'] as const,
    topItems: (categoryId?: string, channel: string | null = null) =>
      ['explore', categoryId ?? 'all', 'top-items', channel ?? 'all-channels'] as const,
    ranking: (slug?: string, channel: string | null = null, rootSlug: string | null = null) =>
      ['explore', 'ranking', slug ?? 'none', channel ?? 'all-channels', rootSlug ?? 'all-roots'] as const,
    rankingCategories: (rootSlug: string | null = null) => ['explore', 'ranking', 'categories', rootSlug ?? 'all-roots'] as const,
    data: (categoryId?: string) => ['explore', categoryId ?? 'all', 'cursor'] as const,
    recentItems: (categoryIds: string[] | null, storesOnly = false) =>
      ['explore', 'recent-items', categoryIds ? [...categoryIds].sort().join(',') : 'all', storesOnly ? 'stores' : 'items'] as const,
  },
  categories: {
    all: ['categories'] as const,
    browse: ['categories', 'browse'] as const,
    open: ['categories', 'open'] as const,
    detail: (categoryId: string) => ['categories', 'detail', categoryId] as const,
    bySlug: (slug: string) => ['categories', 'slug', slug] as const,
  },
  comments: {
    all: ['comments'] as const,
    byPick: (pickId: string) => ['comments', 'pick', pickId, 'cursor'] as const,
    byUser: (userId?: string, scope?: RootCategoryScope | null) =>
      ['comments', 'user', userId ?? 'anonymous', 'cursor', scope ? `${scope.inside ? 'in' : 'out'}:${scope.rootSlug}` : 'every-root'] as const,
  },
  items: {
    all: ['items'] as const,
    detail: (itemId: string, userId?: string) =>
      ['items', 'detail', itemId, userId ?? 'public'] as const,
    channels: (itemId: string) => ['items', 'channels', itemId] as const,
    byCategory: (categoryId: string) => ['items', 'category', categoryId] as const,
    search: (query: string, categoryId?: string, categoryIds?: string[]) =>
      ['items', 'search', query, categoryId ?? (categoryIds ? [...categoryIds].sort().join(',') : 'all')] as const,
    dishChannels: (query: string, userId?: string) => ['items', 'dish-channels', query, userId ?? 'public'] as const,
  },
  movieCatalog: { search: (query: string) => ['movie-catalog', 'search', query] as const },
  musicCatalog: { search: (title: string, artist: string) => ['music-catalog', 'search', title, artist] as const },
  gameCatalog: { search: (query: string) => ['game-catalog', 'search', query] as const },
  bookCatalog: { search: (title: string, author = '') => ['book-catalog', 'search', title, author] as const },
  youtubeCatalog: {
    search: (query: string) => ['youtube-catalog', 'search', query] as const,
    video: (videoId: string) => ['youtube-catalog', 'video', videoId] as const,
  },
  pokemonCatalog: { search: (query: string) => ['pokemon-catalog', 'search', query] as const },
  placeCatalog: {
    enabled: (categoryId: string) => ['place-catalog', 'enabled', categoryId] as const,
    search: (categoryId: string, query: string) => ['place-catalog', 'search', categoryId, query] as const,
  },
  picks: {
    all: ['picks'] as const,
    detail: (pickId: string, userId?: string) => ['picks', 'detail', pickId, userId ?? 'public'] as const,
    current: (userId: string, categoryId: string) => ['picks', 'current', userId, categoryId] as const,
    byUser: (userId: string) => ['picks', 'user', userId] as const,
    byCategory: (categoryId: string) => ['picks', 'category', categoryId] as const,
  },
  providers: {
    all: ['providers'] as const,
    detail: (providerId?: string) => ['providers', 'detail', providerId ?? 'missing'] as const,
  },
  profiles: {
    all: ['profiles'] as const,
    mine: (userId: string) => ['profiles', 'mine', userId] as const,
    history: (userId?: string) => ['profiles', 'history', userId ?? 'anonymous', 'cursor'] as const,
    requests: (userId?: string) => ['profiles', 'requests', userId ?? 'anonymous', 'cursor'] as const,
    byUsername: (username: string, userId?: string) => ['profiles', 'username', username, userId ?? 'public'] as const,
  },
  profileAi: {
    all: ['profile-ai'] as const,
    status: (userId: string) => ['profile-ai', 'status', userId] as const,
    comment: (profileId: string) => ['profile-ai', 'comment', profileId] as const,
  },
  profileTaste: {
    all: ['profile-taste'] as const,
    composition: (profileId: string, viewerId?: string) => ['profile-taste', 'composition', profileId, viewerId ?? 'public'] as const,
  },
  follows: {
    all: ['follows'] as const,
    state: (userId: string, profileId: string) => ['follows', 'state', userId, profileId] as const,
    counts: (userId: string) => ['follows', 'counts', userId] as const,
    publicCounts: (profileId: string, viewerId: string | null) =>
      ['follows', 'public-counts', profileId, viewerId ?? 'public'] as const,
    connections: (profileId: string, direction: 'followers' | 'following', viewerId: string | null) =>
      ['follows', 'connections', profileId, direction, viewerId ?? 'public', 'cursor'] as const,
    feed: (userId: string, channel: string | null = null, rootSlug: string | null = null) =>
      ['follows', 'feed', userId, channel ?? 'all-channels', rootSlug ?? 'all-roots', 'cursor'] as const,
  },
  safety: {
    all: ['safety'] as const,
    blocks: (userId: string) => ['safety', 'blocks', userId] as const,
    reports: ['safety', 'reports'] as const,
  },
} as const;

