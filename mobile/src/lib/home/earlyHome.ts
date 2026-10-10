// Early-MVP Home (Figma 30E, #758 / #762): pure rules for which sections show and what they say.
// Screens pass in data from existing contracts; nothing here fetches, invents counts or picks a
// category on its own. Each rule mirrors a line of the 30E operating box.

import type { PickChannel, PickReadItem } from '@/repositories/interfaces/readRepository';
import type { NotificationGroupRow } from '@/lib/supabase/database.overrides';
import type { Category } from '@/types/domain/category';

/** 30E: below this many Picks in total, "아직 아무도 안 골랐어요" replaces "많이 고른 메뉴". */
export const EARLY_HOME_POPULAR_MIN_TOTAL_PICKS = 30;
/** 30E: "함께하는 사람들" shows from three participants with at least one Pick. */
export const EARLY_HOME_PEOPLE_MIN = 3;
/** 30E: at most five not-yet-picked menus. */
export const EARLY_HOME_UNPICKED_LIMIT = 5;

/**
 * Total Picks across everyone, from `food_menu_pick_counts` (one row per menu, distinct people,
 * suspended members excluded by the server). Never the loaded feed or the viewer's own count.
 * Returns null while the counts are unknown so callers can keep both sections hidden.
 */
export function totalPickCount(counts: ReadonlyMap<string, number> | undefined | null): number | null {
  if (!counts) return null;
  let total = 0;
  for (const value of counts.values()) total += Math.max(0, Number(value) || 0);
  return total;
}

export type EarlyHomeDiscovery = 'unpicked' | 'popular' | null;

/** Which section takes the discovery slot; null while the total is unknown. */
export function earlyHomeDiscovery(total: number | null): EarlyHomeDiscovery {
  if (total === null) return null;
  return total >= EARLY_HOME_POPULAR_MIN_TOTAL_PICKS ? 'popular' : 'unpicked';
}

/**
 * Menus nobody has picked yet, in the catalog's browse order (the same leaf list Explore uses),
 * excluding today's question category, capped at five. Fewer candidates simply return fewer.
 */
export function unpickedCategories(
  menus: readonly Category[],
  counts: ReadonlyMap<string, number>,
  questionCategoryId: string | null,
  limit = EARLY_HOME_UNPICKED_LIMIT,
): Category[] {
  return menus
    .filter((category) => category.id !== questionCategoryId && (counts.get(category.id) ?? 0) <= 0)
    .slice(0, Math.max(0, limit));
}

/** Viewer's current Picks inside the browsed MVP menu set and public channel. */
export function myScopedPicks(currentPicks: readonly PickReadItem[], menuIds: ReadonlySet<string>, channel: PickChannel) {
  return currentPicks.filter(({ pick }) =>
    (pick.status === 'active' || pick.status === 'needs_review')
    && menuIds.has(pick.categoryId)
    && (pick.channel === null || pick.channel === channel));
}

/** The viewer's answer to today's question: their current Pick in that menu, if any. */
export function myQuestionAnswer(scopedPicks: readonly PickReadItem[], questionCategoryId: string | null) {
  if (!questionCategoryId) return null;
  return scopedPicks.find(({ pick }) => pick.categoryId === questionCategoryId) ?? null;
}

/**
 * First-Pick completion (#777 review R1): true only for a 0 → 1 transition in Home's scope —
 * the pre-save list (known, see firstPickNotice) had no scoped Pick and the refreshed list holds
 * exactly the saved Pick. Replacing a single Pick (1→1), adding one (1→2) and repeating a save of
 * an already-current Pick are not first Picks. Unknown pre-save state is never treated as zero.
 */
export function firstPickTransition(
  priorScopedPicks: readonly PickReadItem[] | null | undefined,
  currentScopedPicks: readonly PickReadItem[],
  savedPickId: string | null | undefined,
) {
  if (!priorScopedPicks || !savedPickId) return false;
  return priorScopedPicks.length === 0
    && currentScopedPicks.length === 1
    && currentScopedPicks[0].pick.id === savedPickId;
}

export type QuestionFooter =
  | { kind: 'first-pick-done'; pick: PickReadItem }
  | { kind: 'none-yet' }
  | { kind: 'has-picks'; count: number };

/**
 * Bottom line of the question card. The completion line wins only when a just-saved first Pick
 * was handed over (see firstPickNotice) and it is the viewer's only Pick.
 */
export function questionFooter(scopedPicks: readonly PickReadItem[], justSavedFirstPickId: string | null): QuestionFooter {
  if (justSavedFirstPickId && scopedPicks.length === 1 && scopedPicks[0].pick.id === justSavedFirstPickId) {
    return { kind: 'first-pick-done', pick: scopedPicks[0] };
  }
  if (scopedPicks.length === 0) return { kind: 'none-yet' };
  return { kind: 'has-picks', count: scopedPicks.length };
}

export interface HomeParticipant {
  userId: string;
  /** Account identity: routes and @handles keep using the username (#804). */
  username: string;
  /** Optional public nickname (#804 / #863); screens resolve the shown name through lib/profile/profileName. */
  nickname: string | null;
  profileImageUrl: string | null;
  pickCount: number;
  lastActiveAt: string;
}

/**
 * People with at least one current public Pick, most recent Pick first. Input rows come from the
 * RLS-scoped public `picks` read (active only, suspended/blocked members already removed); this
 * keeps only Picks counted by `food_menu_pick_counts` (eligible menus, public channel).
 * "Recent activity" is the newest `started_at` among a person's current Picks — the same
 * timestamp the public feed sorts by.
 */
export function homeParticipants(
  rows: readonly PickReadItem[],
  eligibleMenuIds: ReadonlySet<string>,
  channel: PickChannel,
): HomeParticipant[] {
  const byUser = new Map<string, HomeParticipant>();
  const seenPicks = new Set<string>();
  for (const { pick, profile } of rows) {
    if (!profile || pick.status !== 'active' || seenPicks.has(pick.id)) continue;
    if (!eligibleMenuIds.has(pick.categoryId) || (pick.channel !== null && pick.channel !== channel)) continue;
    seenPicks.add(pick.id);
    const existing = byUser.get(pick.userId);
    if (existing) {
      existing.pickCount += 1;
      if (pick.startedAt > existing.lastActiveAt) existing.lastActiveAt = pick.startedAt;
    } else {
      byUser.set(pick.userId, {
        userId: pick.userId,
        username: profile.username,
        nickname: profile.nickname ?? null,
        profileImageUrl: profile.profileImageUrl,
        pickCount: 1,
        lastActiveAt: pick.startedAt,
      });
    }
  }
  return [...byUser.values()].sort((a, b) =>
    (a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0) || a.userId.localeCompare(b.userId));
}

export function showParticipants(people: readonly HomeParticipant[]) {
  return people.length >= EARLY_HOME_PEOPLE_MIN;
}

export interface ReplyBanner {
  count: number;
  /** Most recent unread group: opening it follows the inbox's own destination + read contract. */
  target: { groupId: string; snapshot: string; pickId: string };
}

/**
 * "내 원픽에 새 답글 N개": unread `comment` groups (comments on the viewer's own Pick review).
 * Other kinds (new reviews on the same item, replies to the viewer's comments elsewhere, fix
 * requests) are not replies on the viewer's Pick and never count here or get marked read.
 */
export function replyBanner(groups: readonly NotificationGroupRow[]): ReplyBanner | null {
  const seen = new Set<string>();
  const unread = groups.filter((group) => {
    if (seen.has(group.group_id)) return false;
    seen.add(group.group_id);
    return group.kind === 'comment' && group.unread_count > 0 && Boolean(group.target?.pick_id);
  });
  if (!unread.length) return null;
  const latest = unread.reduce((best, group) => (group.latest_at > best.latest_at ? group : best));
  return {
    count: unread.reduce((sum, group) => sum + group.unread_count, 0),
    target: { groupId: latest.group_id, snapshot: latest.snapshot, pickId: latest.target.pick_id! },
  };
}

/** Inbox pages (20 groups each) Home reads at most before giving up on a complete count. */
export const REPLY_BANNER_MAX_PAGES = 5;

export interface ReplyBannerSource<Cursor> {
  /** Unread events of the whole visible inbox (`notification_unread_count`, the badge). */
  unreadCount: () => Promise<number>;
  page: (cursor: Cursor | null) => Promise<{ items: readonly NotificationGroupRow[]; nextCursor: Cursor | null }>;
}

export interface ReplyBannerResult {
  banner: ReplyBanner | null;
  /** The badge total this result was checked against; a different badge means it is out of date. */
  unreadTotal: number;
}

export class ReplyBannerIncompleteError extends Error {
  constructor() {
    super('Unread replies could not be fully counted');
    this.name = 'ReplyBannerIncompleteError';
  }
}

/**
 * Complete unread-reply count for Home (#777 review R2), independent of how far the inbox tab
 * was scrolled. The grouped inbox lists exactly the events the badge counts, so once the loaded
 * groups account for every unread event (or the list ends) no unread `comment` group can be
 * further down. Pages are read only until then, at most `maxPages`; if that bound is reached, or
 * a page fails, this throws instead of returning a partial count — a partial list is never
 * reported as "no replies". Nothing here marks anything read.
 */
export async function collectReplyBanner<Cursor>(
  source: ReplyBannerSource<Cursor>,
  maxPages = REPLY_BANNER_MAX_PAGES,
): Promise<ReplyBannerResult> {
  const unreadTotal = Math.max(0, Number(await source.unreadCount()) || 0);
  if (unreadTotal === 0) return { banner: null, unreadTotal };

  const groups: NotificationGroupRow[] = [];
  const seen = new Set<string>();
  let accounted = 0;
  let cursor: Cursor | null = null;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await source.page(cursor);
    for (const group of page.items) {
      if (seen.has(group.group_id)) continue;
      seen.add(group.group_id);
      groups.push(group);
      accounted += Math.max(0, group.unread_count);
    }
    if (accounted >= unreadTotal || !page.nextCursor) {
      return { banner: replyBanner(groups), unreadTotal };
    }
    cursor = page.nextCursor;
  }
  throw new ReplyBannerIncompleteError();
}

