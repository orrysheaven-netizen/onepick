import type { Href } from 'expo-router';

export type AuthReturnParams = {
  action?: string | string[];
  itemId?: string | string[];
  itemName?: string | string[];
  categoryId?: string | string[];
  pickId?: string | string[];
  externalId?: string | string[];
};

export type AuthIntent =
  | { action: 'register_pick'; categoryId?: string; itemId?: string }
  | { action: 'request_item'; itemName: string; categoryId?: string }
  | { action: 'choose_pick'; itemId: string; categoryId: string }
  | { action: 'choose_movie'; externalId: string; categoryId: string }
  | { action: 'choose_drama'; externalId: string; categoryId: string }
  | { action: 'comment_pick'; pickId: string }
  | { action: 'add_item_photo'; itemId: string }
  | { action: 'profile' }
  | { action: 'home' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isId(value: string | string[] | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
function getItemName(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 100 ? name : null;
}
function getExternalId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^\d{1,12}$/.test(value) ? value : null;
}

export function getAuthIntent(params: AuthReturnParams): AuthIntent {
  if (params.action === 'register_pick') return {
    action: 'register_pick',
    ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}),
    ...(isId(params.itemId) ? { itemId: params.itemId } : {}),
  };
  if (params.action === 'request_item') {
    const itemName = getItemName(params.itemName);
    return itemName ? { action: 'request_item', itemName, ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}) } : { action: 'home' };
  }
  if (params.action === 'choose_pick' && isId(params.itemId) && isId(params.categoryId)) return { action: 'choose_pick', itemId: params.itemId, categoryId: params.categoryId };
  if ((params.action === 'choose_movie' || params.action === 'choose_drama') && isId(params.categoryId)) {
    const externalId = getExternalId(params.externalId);
    if (externalId) return { action: params.action, externalId, categoryId: params.categoryId };
  }
  if (params.action === 'comment_pick' && isId(params.pickId)) return { action: 'comment_pick', pickId: params.pickId };
  if (params.action === 'add_item_photo' && isId(params.itemId)) return { action: 'add_item_photo', itemId: params.itemId };
  return { action: params.action === 'profile' ? 'profile' : 'home' };
}

export function getPostAuthRoute(intent: AuthIntent, needsUsername = false): Href {
  if (needsUsername) return { pathname: '/auth/username', params: { ...intent } };
  switch (intent.action) {
    case 'register_pick': return { pathname: '/pick/register', params: { ...intent } };
    case 'request_item': return { pathname: '/pick/request', params: { itemName: intent.itemName, ...(intent.categoryId ? { categoryId: intent.categoryId } : {}) } };
    case 'choose_pick': return { pathname: '/pick/choose', params: { itemId: intent.itemId, categoryId: intent.categoryId } };
    case 'choose_movie': return { pathname: '/pick/find', params: { categoryId: intent.categoryId, externalMovieId: intent.externalId } };
    case 'choose_drama': return { pathname: '/pick/find', params: { categoryId: intent.categoryId, externalDramaId: intent.externalId } };
    case 'comment_pick': return { pathname: '/pick/[pickId]', params: { pickId: intent.pickId } };
    case 'add_item_photo': return { pathname: '/item/[itemId]', params: { itemId: intent.itemId, photo: '1' } };
    case 'profile': return '/profile';
    default: return '/';
  }
}
