export const queryKeys = {
  home: {
    all: ['home'] as const,
    data: (userId?: string) => ['home', userId ?? 'public'] as const,
  },
  explore: {
    all: ['explore'] as const,
    topItems: (categoryId?: string) => ['explore', categoryId ?? 'all', 'top-items'] as const,
    data: (categoryId?: string) => ['explore', categoryId ?? 'all', 'cursor'] as const,
    recentItems: (categoryIds: string[] | null, storesOnly = false) =>
      ['explore', 'recent-items', categoryIds ? [...categoryIds].sort().join(',') : 'all', storesOnly ? 'stores' : 'items'] as const,
    menuChannels: (categoryId?: string) => ['explore', categoryId ?? 'none', 'menu-channels'] as const,
  },
  categories: {
    all: ['categories'] as const,
    browse: ['categories', 'browse'] as const,
    open: ['categories', 'open'] as const,
    detail: (categoryId: string) => ['categories', 'detail', categoryId] as const,
  },
  comments: {
    all: ['comments'] as const,
    byPick: (pickId: string) => ['comments', 'pick', pickId, 'cursor'] as const,
    byUser: (userId?: string) => ['comments', 'user', userId ?? 'anonymous', 'cursor'] as const,
  },
  items: {
    all: ['items'] as const,
    detail: (itemId: string, userId?: string) =>
      ['items', 'detail', itemId, userId ?? 'public'] as const,
    channels: (itemId: string) => ['items', 'channels', itemId] as const,
    byCategory: (categoryId: string) => ['items', 'category', categoryId] as const,
    search: (query: string, categoryId?: string, categoryIds?: string[]) =>
      ['items', 'search', query, categoryId ?? (categoryIds ? [...categoryIds].sort().join(',') : 'all')] as const,
  },
  movieCatalog: { search: (query: string) => ['movie-catalog', 'search', query] as const },
  musicCatalog: { search: (title: string, artist: string) => ['music-catalog', 'search', title, artist] as const },
  gameCatalog: { search: (query: string) => ['game-catalog', 'search', query] as const },
  bookCatalog: { search: (title: string, author = '') => ['book-catalog', 'search', title, author] as const },
  youtubeCatalog: { search: (query: string) => ['youtube-catalog', 'search', query] as const },
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
  profiles: {
    all: ['profiles'] as const,
    mine: (userId: string) => ['profiles', 'mine', userId] as const,
    history: (userId?: string) => ['profiles', 'history', userId ?? 'anonymous', 'cursor'] as const,
    requests: (userId?: string) => ['profiles', 'requests', userId ?? 'anonymous', 'cursor'] as const,
    byUsername: (username: string, userId?: string) => ['profiles', 'username', username, userId ?? 'public'] as const,
  },
  onboarding: {
    all: ['onboarding'] as const,
    progress: (userId: string) => ['onboarding', 'progress', userId] as const,
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
    feed: (userId: string) => ['follows', 'feed', userId, 'cursor'] as const,
  },
  safety: {
    all: ['safety'] as const,
    blocks: (userId: string) => ['safety', 'blocks', userId] as const,
    reports: ['safety', 'reports'] as const,
  },
} as const;
