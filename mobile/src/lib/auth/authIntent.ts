import type { Href } from 'expo-router';

export type AuthReturnParams = {
  action?: string | string[];
  productId?: string | string[];
  categoryId?: string | string[];
  pickId?: string | string[];
};

export type AuthIntent =
  | { action: 'register_pick'; categoryId?: string; productId?: string }
  | { action: 'choose_pick'; productId: string; categoryId: string }
  | { action: 'comment_pick'; pickId: string }
  | { action: 'profile' }
  | { action: 'home' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isId(value: string | string[] | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function getAuthIntent(params: AuthReturnParams): AuthIntent {
  if (params.action === 'register_pick') {
    return { action: 'register_pick',
      ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}),
      ...(isId(params.productId) ? { productId: params.productId } : {}),
    };
  }
  if (params.action === 'choose_pick' && isId(params.productId) && isId(params.categoryId)) {
    return { action: 'choose_pick', productId: params.productId, categoryId: params.categoryId };
  }
  if (params.action === 'comment_pick' && isId(params.pickId)) {
    return { action: 'comment_pick', pickId: params.pickId };
  }
  return { action: params.action === 'profile' ? 'profile' : 'home' };
}

export function getPostAuthRoute(intent: AuthIntent, needsUsername = false): Href {
  if (needsUsername) {
    return { pathname: '/auth/username', params: { ...intent } };
  }
  switch (intent.action) {
    case 'register_pick':
      return { pathname: '/pick/register', params: { ...intent } };
    case 'choose_pick':
      return { pathname: '/pick/choose', params: { productId: intent.productId, categoryId: intent.categoryId } };
    case 'comment_pick':
      return { pathname: '/pick/[pickId]', params: { pickId: intent.pickId } };
    case 'profile':
      return '/profile';
    default:
      return '/';
  }
}
