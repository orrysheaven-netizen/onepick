// Cloudflare Pages Function helpers for per-link social previews.
//
// `web.output` is `single`, so every route serves the same exported HTML and a
// shared link shows one generic card — or, before this existed, a bare URL.
// These handlers leave the served document alone except for the region between
// the two `onepick:preview` markers, which they refill with the profile or Pick
// the URL actually points at. The app boots from the same HTML either way.
//
// Everything here degrades to the default card: a missing configuration, a slow
// or failing database read, an unknown username and a foreign build with no
// markers all return the untouched asset response rather than an error page.
import {
  pickPreview,
  profilePreview,
  replacePreviewRegion,
  type PreviewContent,
} from '../src/lib/share/linkPreview';

/** A reader waiting on the page matters more than a rich card. */
const LOOKUP_TIMEOUT_MS = 1_200;

export interface PreviewEnv {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
}

export interface PreviewContext {
  request: Request;
  env: PreviewEnv;
  params: Record<string, string | string[]>;
  next: () => Promise<Response>;
}

function firstParam(params: Record<string, string | string[]>, key: string) {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' ? decodeURIComponent(raw) : '';
}

/**
 * Calls a link preview RPC with the public anon key. Both RPCs are SECURITY
 * INVOKER, so this sees exactly what a logged-out visitor sees — a suspended
 * author or a hidden item never reaches a card.
 */
async function callPreviewRpc<T>(env: PreviewEnv, rpc: string, body: Record<string, unknown>): Promise<T | null> {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key || !/^https:\/\//i.test(url)) return null;

  try {
    const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const rows = await response.json();
    return (Array.isArray(rows) ? rows[0] ?? null : rows ?? null) as T | null;
  } catch {
    // A preview is never worth failing the page for.
    return null;
  }
}

async function withPreview(context: PreviewContext, load: (origin: string) => Promise<PreviewContent | null>) {
  const response = await context.next();
  if (!response.headers.get('content-type')?.includes('text/html')) return response;

  const content = await load(new URL(context.request.url).origin).catch(() => null);
  if (!content) return response;

  const html = replacePreviewRegion(await response.text(), content);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

interface ProfileRow {
  username: string;
  pick_count: number | null;
  ai_summary: string | null;
  ai_keywords: string[] | null;
  picks: { categoryName?: string; itemName?: string; oneLineReview?: string }[] | null;
}

export function onProfileRequest(context: PreviewContext) {
  return withPreview(context, async (origin) => {
    const username = firstParam(context.params, 'username');
    if (!username) return null;
    const row = await callPreviewRpc<ProfileRow>(context.env, 'link_preview_profile', { p_username: username });
    if (!row) return null;
    return profilePreview({
      username: row.username,
      pickCount: row.pick_count,
      aiSummary: row.ai_summary,
      aiKeywords: row.ai_keywords,
      picks: row.picks,
    }, origin);
  });
}

interface PickRow {
  username: string;
  category_name: string;
  item_name: string;
  one_line_review: string | null;
}

export function onPickRequest(context: PreviewContext) {
  return withPreview(context, async (origin) => {
    const pickId = firstParam(context.params, 'pickId');
    // A malformed id would reach PostgREST as a cast error, not an empty result.
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pickId)) return null;
    const row = await callPreviewRpc<PickRow>(context.env, 'link_preview_pick', { p_pick_id: pickId });
    if (!row) return null;
    return pickPreview({
      pickId,
      username: row.username,
      categoryName: row.category_name,
      itemName: row.item_name,
      oneLineReview: row.one_line_review,
    }, origin);
  });
}
