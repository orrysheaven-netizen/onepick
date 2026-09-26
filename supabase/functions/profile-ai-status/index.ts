import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}
function relation(value: unknown) {
  return object(Array.isArray(value) ? value[0] : value);
}

function meaningfulChangeCount(previousValue: unknown, currentRows: unknown[]): number {
  const previousRows = Array.isArray(previousValue) ? previousValue.map(object) : [];
  const hasIds = previousRows.some((row) => text(row.categoryId).length > 0);
  // Food Picks are per channel. Snapshots saved before channels existed held one
  // Pick per category, so they are compared per category (same rule as
  // analyze-profile-taste).
  const perChannel = previousRows.some((row) => 'channel' in row);

  const add = (map: Map<string, string[]>, key: string, value: string) => {
    map.set(key, [...(map.get(key) ?? []), value]);
  };
  const joined = (map: Map<string, string[]>) =>
    new Map([...map].map(([key, values]) => [key, JSON.stringify(values.sort())]));

  const previous = new Map<string, string[]>();
  for (const row of previousRows) {
    const categoryName = text(row.category);
    const itemName = text(row.item);
    const categoryKey = hasIds && text(row.categoryId)
      ? text(row.categoryId) : categoryName ? `name:${categoryName}` : '';
    const itemKey = hasIds && text(row.itemId)
      ? text(row.itemId) : itemName ? `name:${itemName}` : '';
    const key = perChannel ? `${categoryKey}|${text(row.channel)}` : categoryKey;
    if (categoryKey) add(previous, key, JSON.stringify([itemKey, text(row.review)]));
  }

  const current = new Map<string, string[]>();
  for (const value of currentRows) {
    const row = object(value);
    const category = relation(row.categories);
    const item = relation(row.items);
    const categoryName = text(category.name);
    const itemName = text(item.name);
    const categoryKey = hasIds && text(row.category_id)
      ? text(row.category_id) : categoryName ? `name:${categoryName}` : '';
    const itemKey = hasIds && text(row.item_id)
      ? text(row.item_id) : itemName ? `name:${itemName}` : '';
    const key = perChannel ? `${categoryKey}|${text(row.channel)}` : categoryKey;
    if (categoryKey) add(current, key, JSON.stringify([itemKey, text(row.one_line_review)]));
  }

  const before = joined(previous);
  const after = joined(current);
  const keys = new Set([...before.keys(), ...after.keys()]);
  let changed = 0;
  for (const key of keys) if (before.get(key) !== after.get(key)) changed += 1;
  return changed;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authorization = req.headers.get('Authorization') ?? '';
  const match = authorization.length <= 8192 ? /^Bearer ([^\s]+)$/i.exec(authorization) : null;
  if (!match) return reply({ error: 'AUTH_REQUIRED' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRole) return reply({ error: 'AI_STATUS_NOT_CONFIGURED' }, 503);

  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const userClient = createClient(url, anonKey, {
    ...options,
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser(match[1]);
  if (authError || !user || user.is_anonymous) return reply({ error: 'AUTH_REQUIRED' }, 401);

  const admin = createClient(url, serviceRole, options);
  // Admin cooldown bypass requires both allowlist membership and an AAL2
  // caller session. The service-role client cannot supply either caller fact.
  const [picksResult, reviewResult, assuranceResult, adminResult] = await Promise.all([
    admin.from('picks')
      .select('category_id,item_id,channel,one_line_review,categories!picks_category_id_fkey!inner(name,is_visible),items!picks_item_category_fk!inner(name,status)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .eq('categories.is_visible', true)
      .in('items.status', ['active', 'discontinued'])
      .limit(50),
    admin.from('profile_ai_reviews')
      .select('generated_at,pick_snapshot,is_visible,is_stale')
      .eq('profile_id', user.id)
      .maybeSingle(),
    userClient.auth.mfa.getAuthenticatorAssuranceLevel(match[1]),
    userClient.rpc('current_user_is_admin'),
  ]);

  if (picksResult.error || reviewResult.error || adminResult.error) return reply({ error: 'AI_STATUS_FAILED' }, 500);
  const isAdmin = adminResult.data === true &&
    !assuranceResult.error && assuranceResult.data.currentLevel === 'aal2';

  const currentRows = picksResult.data ?? [];
  const currentPickCount = currentRows.length;
  const review = reviewResult.data;

  if (!review) {
    const canGenerate = currentPickCount >= 10;
    return reply({
      currentPickCount,
      minimumPicks: 10,
      recommendedPicks: 10,
      hasReview: false,
      reviewPickCount: 0,
      changedCount: 0,
      minimumChanges: 5,
      retryAfterSeconds: 0,
      canGenerate,
      reason: canGenerate ? 'READY_FIRST' : 'NEED_FIRST_PICKS',
      generatedAt: null,
      isVisible: false,
      isStale: false,
    });
  }

  const snapshot = Array.isArray(review.pick_snapshot) ? review.pick_snapshot : [];
  const reviewPickCount = snapshot.length;
  const changedCount = meaningfulChangeCount(snapshot, currentRows);
  let retryAfterSeconds = 0;
  let canGenerate = false;
  let reason = 'NEED_CHANGES';

  if (reviewPickCount < 10) {
    canGenerate = currentPickCount >= 10;
    reason = canGenerate ? 'READY_TEN_PICK_UPGRADE' : 'NEED_TEN_PICKS';
  } else if (isAdmin) {
    // Admins skip the elapsed-time cooldown only — they still need the
    // changed-picks gate below like everyone else.
    canGenerate = changedCount >= 5;
    reason = canGenerate ? 'READY_REANALYSIS' : 'NEED_CHANGES';
  } else {
    const generated = new Date(review.generated_at).getTime();
    const weeklyMs = 7 * 24 * 60 * 60 * 1000;
    const remainingMs = generated + weeklyMs - Date.now();
    retryAfterSeconds = Number.isFinite(remainingMs) && remainingMs > 0
      ? Math.max(1, Math.ceil(remainingMs / 1000)) : 0;
    canGenerate = changedCount >= 5 && retryAfterSeconds === 0;
    reason = changedCount < 5 ? 'NEED_CHANGES'
      : retryAfterSeconds > 0 ? 'WAIT_WEEK' : 'READY_REANALYSIS';
  }

  return reply({
    currentPickCount,
    minimumPicks: 10,
    recommendedPicks: 10,
    hasReview: true,
    reviewPickCount,
    changedCount,
    minimumChanges: 5,
    retryAfterSeconds,
    canGenerate,
    reason,
    generatedAt: review.generated_at,
    isVisible: review.is_visible,
    isStale: review.is_stale,
  });
});
