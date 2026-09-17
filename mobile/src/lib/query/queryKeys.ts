export const queryKeys = {
  home: {
    all: ['home'] as const,
    data: (userId?: string) => ['home', userId ?? 'public'] as const,
  },
  explore: {
    all: ['explore'] as const,
    data: (categoryId?: string) => ['explore', categoryId ?? 'all'] as const,
  },
  categories: {
    all: ['categories'] as const,
    open: ['categories', 'open'] as const,
    detail: (categoryId: string) => ['categories', 'detail', categoryId] as const,
  },
  comments: {
    all: ['comments'] as const,
    byPick: (pickId: string) => ['comments', 'pick', pickId] as const,
  },
  products: {
    all: ['products'] as const,
    detail: (productId: string, userId?: string) =>
      ['products', 'detail', productId, userId ?? 'public'] as const,
    byCategory: (categoryId: string) => ['products', 'category', categoryId] as const,
    search: (query: string, categoryId?: string) =>
      ['products', 'search', query, categoryId ?? 'all'] as const,
  },
  picks: {
    all: ['picks'] as const,
    detail: (pickId: string, userId?: string) =>
      ['picks', 'detail', pickId, userId ?? 'public'] as const,
    current: (userId: string, categoryId: string) =>
      ['picks', 'current', userId, categoryId] as const,
    byUser: (userId: string) => ['picks', 'user', userId] as const,
    byCategory: (categoryId: string) => ['picks', 'category', categoryId] as const,
  },
  profiles: {
    all: ['profiles'] as const,
    mine: (userId: string) => ['profiles', 'mine', userId] as const,
    byUsername: (username: string, userId?: string) =>
      ['profiles', 'username', username, userId ?? 'public'] as const,
  },
  safety: {
    all: ['safety'] as const,
    blocks: (userId: string) => ['safety', 'blocks', userId] as const,
    reports: ['safety', 'reports'] as const,
  },
} as const;
