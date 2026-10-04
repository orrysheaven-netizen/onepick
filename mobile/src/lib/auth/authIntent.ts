import type { Href } from 'expo-router';
import type { PickChannel } from '@/lib/items/pickChannel';

export type AuthReturnParams = {
  action?: string | string[];
  itemId?: string | string[];
  itemName?: string | string[];
  oneLineReview?: string | string[];
  categoryId?: string | string[];
  pickId?: string | string[];
  username?: string | string[];
  externalId?: string | string[];
  externalMusicId?: string | string[];
  externalGameId?: string | string[];
  externalBookId?: string | string[];
  externalYouTubeId?: string | string[];
  externalVideoId?: string | string[];
  externalPokemonId?: string | string[];
  placeCatalogId?: string | string[];
  providerId?: string | string[];
  menuName?: string | string[];
  linkUrl?: string | string[];
  linkName?: string | string[];
  sourceUrl?: string | string[];
  channel?: string | string[];
};

export type AuthIntent =
  | { action: 'register_pick'; categoryId?: string; itemId?: string }
  | { action: 'store_pick'; providerId?: string; categoryId?: string; menuName?: string }
  | { action: 'request_item'; itemName: string; categoryId?: string; sourceUrl?: string; channel?: 'online'; oneLineReview?: string }
  | { action: 'choose_pick'; itemId: string; categoryId: string; channel?: PickChannel }
  | { action: 'choose_movie'; externalId: string; categoryId: string }
  | { action: 'choose_drama'; externalId: string; categoryId: string }
  | { action: 'choose_music'; externalMusicId: string; categoryId: string }
  | { action: 'choose_game'; externalGameId: string; categoryId: string }
  | { action: 'choose_book'; externalBookId: string; categoryId: string }
  | { action: 'choose_youtube'; externalYouTubeId: string; categoryId: string }
  | { action: 'choose_recipe'; externalVideoId: string; categoryId?: string }
  | { action: 'choose_pokemon'; externalPokemonId: string; categoryId: string }
  | { action: 'choose_place'; placeCatalogId: string; categoryId: string }
  | { action: 'suggest_link_category'; linkUrl: string; linkName?: string }
  | { action: 'comment_pick'; pickId: string }
  | { action: 'add_item_photo'; itemId: string }
  | { action: 'view_profile'; username: string }
  | { action: 'follow_profile'; username: string }
  | { action: 'join_from_profile' }
  | { action: 'profile' }
  | { action: 'my_comments' }
  | { action: 'notifications' }
  | { action: 'home' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isId(value: string | string[] | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
function isUsername(value: string | string[] | undefined): value is string {
  return typeof value === 'string' && /^[a-z0-9_]{3,20}$/.test(value);
}
function getItemName(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 100 ? name : null;
}
function getMenuName(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 40 ? name : null;
}
function getExternalId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^\d{1,12}$/.test(value) ? value : null;
}
function getExternalMusicId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}
function getExternalGameId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^\d{1,12}$/.test(value) ? value : null;
}
function getExternalBookId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}
function getExternalYouTubeId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value) ? value : null;
}
function getExternalVideoId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}
function getExternalPokemonId(value: string | string[] | undefined) {
  return typeof value === 'string' && /^\d{1,6}$/.test(value) ? value : null;
}
function getHttpsUrl(value: string | string[] | undefined) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function getAuthIntent(params: AuthReturnParams): AuthIntent {
  if (params.action === 'register_pick') return {
    action: 'register_pick',
    ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}),
    ...(isId(params.itemId) ? { itemId: params.itemId } : {}),
  };
  if (params.action === 'request_item') {
    const itemName = getItemName(params.itemName);
    const sourceUrl = getHttpsUrl(params.sourceUrl);
    const oneLineReview = getItemName(params.oneLineReview);
    return itemName ? {
      action: 'request_item',
      itemName,
      ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(params.channel === 'online' ? { channel: 'online' as const } : {}),
      ...(oneLineReview ? { oneLineReview } : {}),
    } : { action: 'home' };
  }
  if (params.action === 'choose_pick' && isId(params.itemId) && isId(params.categoryId)) {
    const channel = params.channel === 'offline' || params.channel === 'online' || params.channel === 'recipe' ? params.channel : undefined;
    return { action: 'choose_pick', itemId: params.itemId, categoryId: params.categoryId, ...(channel ? { channel } : {}) };
  }
  if ((params.action === 'choose_movie' || params.action === 'choose_drama') && isId(params.categoryId)) {
    const externalId = getExternalId(params.externalId);
    if (externalId) return { action: params.action, externalId, categoryId: params.categoryId };
  }
  if (params.action === 'choose_music' && isId(params.categoryId)) {
    const externalMusicId = getExternalMusicId(params.externalMusicId);
    if (externalMusicId) return { action: 'choose_music', externalMusicId, categoryId: params.categoryId };
  }
  if (params.action === 'choose_game' && isId(params.categoryId)) {
    const externalGameId = getExternalGameId(params.externalGameId);
    if (externalGameId) return { action: 'choose_game', externalGameId, categoryId: params.categoryId };
  }
  if (params.action === 'choose_book' && isId(params.categoryId)) {
    const externalBookId = getExternalBookId(params.externalBookId);
    if (externalBookId) return { action: 'choose_book', externalBookId, categoryId: params.categoryId };
  }
  if (params.action === 'choose_youtube' && isId(params.categoryId)) {
    const externalYouTubeId = getExternalYouTubeId(params.externalYouTubeId);
    if (externalYouTubeId) return { action: 'choose_youtube', externalYouTubeId, categoryId: params.categoryId };
  }
  if (params.action === 'choose_recipe') {
    // The dish is optional: a recipe link can be confirmed against any dish after login.
    const externalVideoId = getExternalVideoId(params.externalVideoId);
    if (externalVideoId) return { action: 'choose_recipe', externalVideoId, ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}) };
  }
  if (params.action === 'choose_pokemon' && isId(params.categoryId)) {
    const externalPokemonId = getExternalPokemonId(params.externalPokemonId);
    if (externalPokemonId) return { action: 'choose_pokemon', externalPokemonId, categoryId: params.categoryId };
  }
  if (params.action === 'choose_place' && isId(params.categoryId) && isId(params.placeCatalogId)) {
    return { action: 'choose_place', placeCatalogId: params.placeCatalogId, categoryId: params.categoryId };
  }
  if (params.action === 'suggest_link_category') {
    const linkUrl = getHttpsUrl(params.linkUrl);
    const linkName = getItemName(params.linkName);
    if (linkUrl) return { action: 'suggest_link_category', linkUrl, ...(linkName ? { linkName } : {}) };
  }
  if (params.action === 'comment_pick' && isId(params.pickId)) return { action: 'comment_pick', pickId: params.pickId };
  if (params.action === 'add_item_photo' && isId(params.itemId)) return { action: 'add_item_photo', itemId: params.itemId };
  if (params.action === 'view_profile' && isUsername(params.username)) return { action: 'view_profile', username: params.username };
  if (params.action === 'follow_profile' && isUsername(params.username)) return { action: 'follow_profile', username: params.username };
  if (params.action === 'join_from_profile') return { action: 'join_from_profile' };
  if (params.action === 'store_pick') {
    const menuName = getMenuName(params.menuName);
    return {
      action: 'store_pick',
      ...(isId(params.providerId) ? { providerId: params.providerId } : {}),
      ...(isId(params.categoryId) ? { categoryId: params.categoryId } : {}),
      ...(menuName ? { menuName } : {}),
    };
  }
  if (params.action === 'my_comments') return { action: 'my_comments' };
  if (params.action === 'notifications') return { action: 'notifications' };
  return { action: params.action === 'profile' ? 'profile' : 'home' };
}

export function getPostAuthRoute(intent: AuthIntent, needsUsername = false): Href {
  if (needsUsername) return { pathname: '/auth/username', params: { ...intent } };
  switch (intent.action) {
    case 'register_pick': return { pathname: '/pick/register', params: { ...intent } };
    case 'store_pick': return intent.providerId || intent.categoryId || intent.menuName
      ? {
          pathname: '/pick/new',
          params: {
            ...(intent.providerId ? { providerId: intent.providerId } : {}),
            ...(intent.categoryId ? { categoryId: intent.categoryId } : {}),
            ...(intent.menuName ? { menuName: intent.menuName } : {}),
          },
        }
      : '/pick/new';
    case 'request_item': return {
      pathname: '/pick/request',
      params: {
        itemName: intent.itemName,
        ...(intent.categoryId ? { categoryId: intent.categoryId } : {}),
        ...(intent.sourceUrl ? { sourceUrl: intent.sourceUrl } : {}),
        ...(intent.channel ? { channel: intent.channel } : {}),
        ...(intent.oneLineReview ? { oneLineReview: intent.oneLineReview } : {}),
      },
    };
    case 'choose_pick': return { pathname: '/pick/choose', params: { itemId: intent.itemId, categoryId: intent.categoryId, ...(intent.channel ? { channel: intent.channel } : {}) } };
    case 'choose_movie': return { pathname: '/pick/find', params: { categoryId: intent.categoryId, externalMovieId: intent.externalId } };
    case 'choose_drama': return { pathname: '/pick/find', params: { categoryId: intent.categoryId, externalDramaId: intent.externalId } };
    case 'choose_music': return { pathname: '/pick/music', params: { categoryId: intent.categoryId, externalMusicId: intent.externalMusicId } };
    case 'choose_game': return { pathname: '/pick/game', params: { categoryId: intent.categoryId, externalGameId: intent.externalGameId } };
    case 'choose_book': return { pathname: '/pick/book', params: { categoryId: intent.categoryId, externalBookId: intent.externalBookId } };
    case 'choose_youtube': return { pathname: '/pick/youtube', params: { categoryId: intent.categoryId, externalYouTubeId: intent.externalYouTubeId } };
    case 'choose_recipe': return { pathname: '/pick/recipe', params: { externalVideoId: intent.externalVideoId, ...(intent.categoryId ? { categoryId: intent.categoryId } : {}) } };
    case 'choose_pokemon': return { pathname: '/pick/pokemon', params: { categoryId: intent.categoryId, externalPokemonId: intent.externalPokemonId } };
    case 'choose_place': return { pathname: '/pick/find', params: { categoryId: intent.categoryId, placeCatalogId: intent.placeCatalogId } };
    case 'suggest_link_category': return { pathname: '/pick/link', params: { url: intent.linkUrl, ...(intent.linkName ? { name: intent.linkName } : {}) } };
    // afterAuth: a viewer still without a Pick of this menu gets the pick-first popup on arrival.
    case 'comment_pick': return { pathname: '/pick/[pickId]', params: { pickId: intent.pickId, afterAuth: '1' } };
    case 'add_item_photo': return { pathname: '/item/[itemId]', params: { itemId: intent.itemId, photo: '1' } };
    case 'view_profile': return { pathname: '/u/[username]', params: { username: intent.username } };
    case 'follow_profile': return { pathname: '/u/[username]', params: { username: intent.username } };
    // A visitor who came to make their own Picks lands on the feed, not back on the profile they read.
    case 'join_from_profile': return '/';
    case 'profile': return '/profile';
    case 'my_comments': return '/comments';
    case 'notifications': return '/notifications';
    default: return '/';
  }
}
