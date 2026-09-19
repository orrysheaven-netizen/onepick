import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { PROFILE_AI_COOLDOWN_SECONDS, PROFILE_AI_PROFILE_AI_MIN_PICKS } from './contract.ts';
import { inspectRequest, reply } from './request.ts';
import { assertNoAgeComment, buildTasteInput, TASTE_INSTRUCTIONS, TASTE_PROMPT_VERSION } from './quality.ts';

const MODEL = 'gpt-5.6-terra';
const PROMPT_VERSION = TASTE_PROMPT_VERSION;
const COOLDOWN_MS = PROFILE_AI_COOLDOWN_SECONDS * 1000;
const REVIEW_COLUMNS = 'id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,created_at,updated_at';
const ACTOR_COLUMNS = 'id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function relation(value: unknown) {
  return record(Array.isArray(value) ? value[0] : value);
}
function textOrNull(value: unknown, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : null;
}
function buildSnapshot(rows: unknown[]) {
  return rows.map((value) => {
    const pick = record(value);
    const category = relation(pick.categories);
    const item = relation(pick.items);
    return {
      pickId: textOrNull(pick.id, 36),
      category: textOrNull(category.name),
      item: textOrNull(item.name),
      originalName: textOrNull(item.original_name),
      releaseYear: typeof item.release_year === 'number' ? item.release_year : null,
      creatorName: textOrNull(item.creator_name),
      collectionName: textOrNull(item.collection_name),
      review: textOrNull(pick.one_line_review, 100),
      updatedAt: textOrNull(pick.updated_at, 40),
    };
  }).filter((pick) => pick.pickId && pick.category && pick.item && pick.review);
}
async function fingerprint(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function outputText(value: unknown) {
  const payload = record(value);
  if (payload.status !== 'completed' || !Array.isArray(payload.output)) return null;
  const fragments: string[] = [];
  for (const entry of payload.output) {
    const item = record(entry);
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const entry of item.content) {
      const content = record(entry);
      if (content.type === 'refusal') return null;
      if (content.type === 'output_text' && typeof content.text === 'string') fragments.push(content.text);
    }
  }
  return fragments.length ? fragments.join('') : null;
}
function cleanResult(value: unknown) {
  const result = record(value);
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  const body = typeof result.body === 'string' ? result.body.trim() : '';
  const keywords = Array.isArray(result.keywords)
    ? result.keywords.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
    : [];
  if (!summary || summary.length > 180 || !body || body.length > 1200 ||
    keywords.length !== 3 || new Set(keywords).size !== 3 ||
    keywords.some((keyword) => !keyword || keyword.length > 24)) {
    throw new Error('AI_REVIEW_INVALID');
  }
  return { summary, body, keywords };
}

Deno.serve(async (req: Request) => {
  // Only GET /status and OPTIONS are public. Every generation request below
  // requires Auth.getUser validation; an apikey/bearer-shaped string is not a user.
  const request = inspectRequest(req, (name) => Deno.env.get(name));
  if (request instanceof Response) return request;
  const { authorization } = request;

  let retryAfterReservation: number | null = null;
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
    if (!url || !anonKey) return reply({ error: 'AI_REVIEW_FAILED' }, 500);
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const userClient = createClient(url, anonKey, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authorization.slice(7));
    if (authError || !user || user.is_anonymous) return reply({ error: 'AUTH_REQUIRED' }, 401);
    if (!serviceRole || !openAiKey) return reply({ error: 'AI_NOT_CONFIGURED' }, 503);

    // Source reads obey public visibility, not the owner's elevated visibility.
    const publicClient = createClient(url, anonKey, options);
    const admin = createClient(url, serviceRole, options);
    const { data: profile, error: profileError } = await publicClient
      .from('profiles').select('id').eq('id', user.id).maybeSingle();
    if (profileError) throw new Error('AI_PROFILE_READ_FAILED');
    if (!profile) return reply({ error: 'FORBIDDEN' }, 403);

    const readSourceVersion = async () => {
      const { data, error } = await admin.from('profile_ai_generation_limits')
        .select('source_version').eq('profile_id', user.id).maybeSingle();
      if (error) throw new Error('AI_SOURCE_VERSION_FAILED');
      const version = Number(data?.source_version ?? 0);
      if (!Number.isSafeInteger(version) || version < 0) throw new Error('AI_SOURCE_VERSION_FAILED');
      return version;
    };
    const readRetryAfterSeconds = async () => {
      try {
        const { data, error } = await admin.from('profile_ai_generation_limits')
          .select('next_allowed_at').eq('profile_id', user.id).maybeSingle();
        if (error || typeof data?.next_allowed_at !== 'string') return PROFILE_AI_COOLDOWN_SECONDS;
        const remainingMs = new Date(data.next_allowed_at).getTime() - Date.now();
        if (!Number.isFinite(remainingMs)) return PROFILE_AI_COOLDOWN_SECONDS;
        return Math.max(1, Math.min(PROFILE_AI_COOLDOWN_SECONDS, Math.ceil(remainingMs / 1000)));
      } catch {
        return PROFILE_AI_COOLDOWN_SECONDS;
      }
    };
    const readSnapshot = async () => {
      const { data, error } = await publicClient.from('picks')
        .select('id,one_line_review,updated_at,categories!picks_category_id_fkey!inner(name),items!picks_item_category_fk!inner(name,original_name,release_year,creator_name,collection_name)')
        .eq('user_id', user.id).eq('status', 'active')
        .eq('categories.is_visible', true)
        .in('items.status', ['active', 'discontinued'])
        .order('id', { ascending: true }).limit(50);
      if (error) throw new Error('AI_SOURCE_READ_FAILED');
      return buildSnapshot(data ?? []);
    };
    const sourceVersion = await readSourceVersion();
    const snapshot = await readSnapshot();
    // Check before cached results, quota reservation and any paid model call.
    // Never trust a count supplied by the requesting client.
    if (snapshot.length < PROFILE_AI_MIN_PICKS) return reply({
      error: 'AI_NOT_ENOUGH_PICKS', minimum: PROFILE_AI_MIN_PICKS,
      count: snapshot.length, remaining: PROFILE_AI_MIN_PICKS - snapshot.length,
    }, 409);
    if (await readSourceVersion() !== sourceVersion) return reply({ error: 'AI_REVIEW_STALE' }, 409);
    const tasteInput = buildTasteInput(snapshot);
    // Age-reference time is no longer part of the input or cache fingerprint.
    const sourceFingerprint = await fingerprint(snapshot);

    const { data: existing, error: existingError } = await admin.from('profile_ai_reviews')
      .select(`${REVIEW_COLUMNS},source_fingerprint,source_version,model_name,prompt_version`)
      .eq('profile_id', user.id).maybeSingle();
    if (existingError) throw new Error('AI_REVIEW_READ_FAILED');
    const { data: actor, error: actorError } = await admin.from('system_actors')
      .select(ACTOR_COLUMNS).eq('slug', 'onepick_ai').eq('is_active', true).single();
    if (actorError || !actor) throw new Error('AI_ACTOR_NOT_FOUND');

    if (existing && !existing.is_stale && Number(existing.source_version) === sourceVersion &&
      existing.source_fingerprint === sourceFingerprint &&
      existing.model_name === MODEL && existing.prompt_version === PROMPT_VERSION) {
      if (await readSourceVersion() !== sourceVersion) return reply({ error: 'AI_REVIEW_STALE' }, 409);
      const { source_fingerprint: _fingerprint, source_version: _version,
        model_name: _model, prompt_version: _prompt, ...review } = existing;
      assertNoAgeComment(review);
      return reply({ review, actor, reused: true });
    }
    if (existing?.generated_at) {
      const elapsedMs = Date.now() - new Date(existing.generated_at).getTime();
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < COOLDOWN_MS) return reply({
        error: 'RATE_LIMITED',
        retryAfterSeconds: Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 1000)),
      }, 429);
    }
    const { data: reserved, error: reservationError } = await admin
      .rpc('reserve_profile_ai_generation', { p_profile_id: user.id });
    if (reservationError) throw new Error('AI_RESERVATION_FAILED');
    if (reserved !== true) return reply({ error: 'RATE_LIMITED', retryAfterSeconds: await readRetryAfterSeconds() }, 429);
    retryAfterReservation = await readRetryAfterSeconds();

    // Input is allowlisted in quality.ts. Editorial references are never loaded
    // here, and generated comments never use examples as the user's biography.
    const modelResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 1600,
        instructions: TASTE_INSTRUCTIONS,
        input: JSON.stringify(tasteInput),
        text: { format: {
          type: 'json_schema', name: 'onepick_taste_profile', strict: true,
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string', minLength: 1, maxLength: 180 },
              body: { type: 'string', minLength: 1, maxLength: 1200 },
              keywords: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 24 }, minItems: 3, maxItems: 3 },
            },
            required: ['summary', 'body', 'keywords'], additionalProperties: false,
          },
        } },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!modelResponse.ok) {
      console.error('AI_PROVIDER_FAILED', modelResponse.status);
      await modelResponse.body?.cancel();
      return reply({ error: 'AI_REVIEW_FAILED', retryAfterSeconds: retryAfterReservation }, 502);
    }
    const output = outputText(await modelResponse.json());
    if (!output) throw new Error('AI_REVIEW_EMPTY_OR_REFUSED');
    const generated = cleanResult(JSON.parse(output));
    // Limited wording check, not complete semantic or tone moderation.
    assertNoAgeComment(generated);

    const latestSnapshot = await readSnapshot();
    if (await fingerprint(latestSnapshot) !== sourceFingerprint) {
      return reply({ error: 'AI_REVIEW_STALE', retryAfterSeconds: retryAfterReservation }, 409);
    }
    // The DB compares source versions while holding the same row lock used by
    // source-change triggers. This closes the final read-to-write race window.
    const { data: saved, error: saveError } = await admin.rpc('save_profile_ai_review', {
      p_profile_id: user.id,
      p_source_version: sourceVersion,
      p_actor_id: actor.id,
      p_summary: generated.summary,
      p_body: generated.body,
      p_keywords: generated.keywords,
      p_pick_snapshot: snapshot,
      p_source_fingerprint: sourceFingerprint,
      p_model_name: MODEL,
      p_prompt_version: PROMPT_VERSION,
    });
    if (saveError?.message === 'AI_REVIEW_STALE') return reply({ error: 'AI_REVIEW_STALE', retryAfterSeconds: retryAfterReservation }, 409);
    if (saveError || !saved) throw new Error('AI_REVIEW_SAVE_FAILED');
    return reply({ review: saved, actor, reused: false });
  } catch {
    console.error('AI_REVIEW_FAILED');
    return reply(retryAfterReservation
      ? { error: 'AI_REVIEW_FAILED', retryAfterSeconds: retryAfterReservation }
      : { error: 'AI_REVIEW_FAILED' }, 500);
  }
});
