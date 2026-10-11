import { OnePickMvp } from '@/constants/onepick';
import type { PickChannel } from '@/lib/items/pickChannel';

/**
 * Route param that says a detail/menu screen was opened from Home (전체·팔로잉, /feed,
 * 오늘의 질문). Home publicly shows 오프라인 식당 + 온라인 음식 (#762, 2026-10-10), so the
 * destination must be able to show the same Picks. Every other entry keeps the offline
 * MVP scope; registration stays offline either way.
 */
export const HOME_ROUTE_SCOPE = 'home' as const;

/** Public food channels for a detail/menu screen: Home's channels for `scope=home`, offline otherwise. */
export function publicFoodChannels(routeScope: unknown): readonly PickChannel[] {
  return routeScope === HOME_ROUTE_SCOPE ? OnePickMvp.homeFeedChannels : [OnePickMvp.publicPickChannel];
}

/** True when the Pick's channel is one of the screen's public channels. */
export function isPublicFoodChannel(channel: PickChannel | null | undefined, channels: readonly PickChannel[]) {
  return Boolean(channel && channels.includes(channel));
}

/**
 * Route params that carry Home's scope onward (#762 review 6107698831). Every in-app link and
 * no-history fallback out of a Home-scoped screen must keep `scope=home`, or an online Pick that
 * was readable a moment ago is closed on return. Any other value carries nothing (offline).
 */
export function homeScopeParams(routeScope: unknown): { scope?: typeof HOME_ROUTE_SCOPE } {
  return routeScope === HOME_ROUTE_SCOPE ? { scope: HOME_ROUTE_SCOPE } : {};
}

/** Query suffix a scoped screen appends to its own profile `returnTo` path (`''` outside Home). */
export const HOME_SCOPE_QUERY = `?scope=${HOME_ROUTE_SCOPE}` as const;
export function homeScopeQuery(routeScope: unknown): '' | typeof HOME_SCOPE_QUERY {
  return routeScope === HOME_ROUTE_SCOPE ? HOME_SCOPE_QUERY : '';
}
