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
function meaningfulChangeCount(previousValue: unknown, currentRows: unknown[]): number {
  const previousRows = Array.isArray(previousValue) ? previousValue.map(object) : [];
  const hasIds = previousRows.some((row) => text(row.categoryId).length > 0);

  const previous = new Map<string, string>();
  for (const row of previousRows) {
    const categoryName = text(row.category);
    const itemName = text(row.item);
    const categoryKey = hasIds && text(row.categoryId)
      ? text(row.categoryId) : categoryName ? `name:${categoryName}` : '';
    const itemKey = hasIds && text(row.itemId)
      ? text(row.itemId) : itemName ? `name:${itemName}` : '';
    if (categoryKey) previous.set(categoryKey, JSON.stringify([itemKey, text(row.review)]));
  }

  const current = new Map<string, string>();
  for (const value of currentRows) {
    const row = object(value);
    const categoryName = text(row.category_name);
    const itemName = text(row.item_name);
    const categoryKey = hasIds && text(row.category_id)
      ? text(row.category_id) : categoryName ? `name:${categoryName}` : '';
    const itemKey = hasIds && text(row.item_id)
      ? text(row.item_id) : itemName ? `name:${itemName}` : '';
    if (categoryKey) current.set(categoryKey, JSON.stringify([itemKey, text(row.one_line_review)]));
  }

  const keys = new Set([...previous.keys(), ...current.keys()]);
  let changed = 0;
  for (const key of keys) if (previous.get(key) !== current.get(key)) changed += 1;
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
  // current_user_is_admin reads auth.uid() from the caller's own JWT, so it
  // must run on userClient (the service-role admin client carries no real
  // end-user identity).
  // Two pick reads with different jobs. profile_taste_picks is the one the
  // gates below use: it is the single definition shared with
  // analyze-profile-taste, so the count that opens the button and the material
  // the AI actually reads cannot drift apart. The plain picks read stays only
  // to keep currentPickCount meaning "every visible active pick", which is the
  // number the profile shows elsewhere.
  const [picksResult, tasteResult, reviewResult, adminResult] = await Promise.all([
    admin.from('picks')
      .select('id,categories!picks_category_id_fkey!inner(is_visible),items!picks_item_category_fk!inner(status)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .eq('categories.is_visible', true)
      .in('items.status', ['active', 'discontinued'])
      .limit(50),
    admin.rpc('profile_taste_picks', { p_profile_id: user.id }),
    admin.from('profile_ai_reviews')
      .select('generated_at,pick_snapshot,is_visible,is_stale')
      .eq('profile_id', user.id)
      .maybeSingle(),
    userClient.rpc('current_user_is_admin'),
  ]);

  if (picksResult.error || tasteResult.error || reviewResult.error || adminResult.error) {
    return reply({ error: 'AI_STATUS_FAILED' }, 500);
  }
  const isAdmin = adminResult.data === true;

  const currentPickCount = (picksResult.data ?? []).length;
  const tasteRows = tasteResult.data ?? [];
  const tastePickCount = tasteRows.length;
  const review = reviewResult.data;

  if (!review) {
    const canGenerate = tastePickCount >= 5;
    return reply({
      currentPickCount,
      tastePickCount,
      minimumPicks: 5,
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
  const changedCount = meaningfulChangeCount(snapshot, tasteRows);
  let retryAfterSeconds = 0;
  let canGenerate = false;
  let reason = 'NEED_CHANGES';

  if (reviewPickCount < 10) {
    canGenerate = tastePickCount >= 10;
    reason = canGenerate ? 'READY_TEN_PICK_UPGRADE' : 'NEED_TEN_PICKS';
  } else if (isAdmin) {
    // Admins skip the elapsed-time cooldown only — they still need the
    // changed-picks gate below like everyone else.
    canGenerate = changedCount >= 5;
    reason = canGenerate ? 'READY_REANALYSIS' : 'NEED_CHANGES';
  } else {
    const generated = new Date(review.generated_at).getTime();
    const dailyMs = 24 * 60 * 60 * 1000;
    const remainingMs = generated + dailyMs - Date.now();
    retryAfterSeconds = Number.isFinite(remainingMs) && remainingMs > 0
      ? Math.max(1, Math.ceil(remainingMs / 1000)) : 0;
    canGenerate = changedCount >= 5 && retryAfterSeconds === 0;
    reason = changedCount < 5 ? 'NEED_CHANGES'
      : retryAfterSeconds > 0 ? 'WAIT_DAY' : 'READY_REANALYSIS';
  }

  return reply({
    currentPickCount,
    tastePickCount,
    minimumPicks: 5,
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
