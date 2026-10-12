// One-shot handoff from a successful Pick save to Home's "원픽 완료 · 친구에게 공유하기" line
// (Figma 30E). Set only from mutation onSuccess, so a cancelled flow or a failed save never
// arms it. In-memory only: a reload, another device or a shared link never replays it.
//
// "First" means the viewer went from zero current Picks to this one save (#777 review R1).
// The pre-save list is captured before the mutation runs, from a settled, non-invalidated Home
// context cache. When that list is unknown the notice is never armed: an unknown count is not
// treated as zero. Home compares the pre-save list with the refreshed list in the same scope
// (see earlyHome.firstPickTransition), so replacing a single Pick (1→1), adding a second (1→2)
// or a repeated save of an already-current Pick never counts as a first Pick.

import type { QueryClient } from '@tanstack/react-query';

import type { PickReadItem } from '@/repositories/interfaces/readRepository';

type PriorPicks = readonly PickReadItem[];

/**
 * Home context cache key: `[...queryKeys.home.data(userId), 'context', channel, rootSlug]`
 * (useHomeData). Spelled out here so this module stays import-free for the screen tests; the
 * early-Home suite checks it still matches queryKeys.
 */
export const HOME_CONTEXT_KEY = { root: 'home', segment: 'context' } as const;

let pending: { userId: string; pickId: string; priorPicks: PriorPicks } | null = null;

/**
 * The viewer's current Picks as Home last read them, per user id, before a save. Only a cache
 * entry that loaded successfully, is not invalidated and is not mid-refetch is trusted; any
 * other state leaves that user out (unknown).
 */
export function captureTrustedCurrentPicks(client: Pick<QueryClient, 'getQueryCache'>): Map<string, PriorPicks> {
  const result = new Map<string, PriorPicks>();
  for (const query of client.getQueryCache().findAll({ queryKey: [HOME_CONTEXT_KEY.root] })) {
    const key = query.queryKey as readonly unknown[];
    const userId = key[1];
    if (key[2] !== HOME_CONTEXT_KEY.segment || typeof userId !== 'string' || userId === 'public') continue;
    const { status, isInvalidated, fetchStatus, data } = query.state;
    const picks = (data as { currentPicks?: unknown } | undefined)?.currentPicks;
    if (status !== 'success' || isInvalidated || fetchStatus !== 'idle' || !Array.isArray(picks)) continue;
    if (!result.has(userId)) result.set(userId, picks as PriorPicks);
  }
  return result;
}

/** Arms the notice only when the pre-save list for this user is known. */
export function armFirstPickNotice(userId: string, pickId: string, priorPicks: PriorPicks | null | undefined) {
  if (!userId || !pickId || !priorPicks) {
    pending = null;
    return;
  }
  pending = { userId, pickId, priorPicks };
}

/** The just-saved Pick and the viewer's pre-save Picks, without consuming it. */
export function peekFirstPickNotice(userId: string | undefined) {
  return userId && pending?.userId === userId ? { pickId: pending.pickId, priorPicks: pending.priorPicks } : null;
}

/** Clears the handoff once Home has shown (or ruled out) the completion line. */
export function consumeFirstPickNotice(userId: string | undefined, pickId: string) {
  if (!userId || pending?.userId !== userId || pending.pickId !== pickId) return false;
  pending = null;
  return true;
}

