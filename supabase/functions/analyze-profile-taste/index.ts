import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { PROFILE_AI_COOLDOWN_SECONDS, PROFILE_AI_MIN_PICKS } from './contract.ts';
import { inspectRequest, reply } from './request.ts';
import { logProfileAiServerPerformance, type ProfileAiServerOutcome } from './performance.ts';
import { assertNoAgeComment, buildTasteInput, TASTE_INSTRUCTIONS, TASTE_PROMPT_VERSION } from './quality.ts';
import { readTasteTone, tasteInstructions, tastePromptVersion } from './tone.ts';

const MODEL = 'gpt-5.6-terra';
const PROMPT_VERSION = TASTE_PROMPT_VERSION;
const COOLDOWN_MS = PROFILE_AI_COOLDOWN_SECONDS * 1000;
const REVIEW_COLUMNS = 'id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,created_at,updated_at,tone';
const ACTOR_COLUMNS = 'id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function relation(value: unknown) { return record(Array.isArray(value) ? value[0] : value); }
function textOrNull(value: unknown, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : null;
}
function buildSnapshot(rows: unknown[]) {
  return rows.map((value) => {
    const pick = record(value);
    const category = relation(pick.categories);
    const item = relation(pick.items);
    return {
      pickId: textOrNull(pick.id, 36), category: textOrNull(category.name), item: textOrNull(item.name),
      originalName: textOrNull(item.original_name),
      releaseYear: typeof item.release_year === 'number' ? item.release_year : null,
      creatorName: textOrNull(item.creator_name), collectionName: textOrNull(item.collection_name),
      review: textOrNull(pick.one_line_review, 100), updatedAt: textOrNull(pick.updated_at, 40),
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
    ? result.keywords.filter((item): item is string => typeof item === 'string').map((item) => item.trim()) : [];
  if (!summary || summary.length > 180 || !body || body.length > 1200 ||
    keywords.length !== 3 || new Set(keywords).size !== 3 ||
    keywords.some((keyword) => !keyword || keyword.length > 24)) throw new Error('AI_REVIEW_INVALID');
  return { summary, body, keywords };
}

Deno.serve(async (req: Request) => {
  const request = inspectRequest(req, (name) => Deno.env.get(name));
  if (request instanceof Response) return request;
  const { authorization } = request;
  const perfStartedAt = performance.now();
  let perfTone: 'direct' | 'warm' | null = null;
  let authFinishedAt: number | null = null;
  let providerStartedAt: number | null = null;
  let providerFinishedAt: number | null = null;
  let saveStartedAt: number | null = null;
  let saveFinishedAt: number | null = null;
  let retryAfterReservation: number | null = null;
  const finish = (outcome: ProfileAiServerOutcome, response: Response) => {
    const now = performance.now();
    const preflightEnd = providerStartedAt ?? saveStartedAt ?? now;
    logProfileAiServerPerformance({
      outcome,
      tone: perfTone,
      authMs: authFinishedAt === null ? null : authFinishedAt - perfStartedAt,
      preflightMs: authFinishedAt === null ? null : Math.max(0, preflightEnd - authFinishedAt),
      providerMs: providerStartedAt === null ? null : (providerFinishedAt ?? now) - providerStartedAt,
      saveMs: saveStartedAt === null ? null : (saveFinishedAt ?? now) - saveStartedAt,
      totalMs: now - perfStartedAt,
    });
    return response;
  };
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY')?.trim();
    if (!url || !anonKey) return finish('failed', reply({ error: 'AI_REVIEW_FAILED' }, 500));
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const userClient = createClient(url, anonKey, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authorization.slice(7));
    authFinishedAt = performance.now();
    if (authError || !user || user.is_anonymous) return finish('auth_required', reply({ error: 'AUTH_REQUIRED' }, 401));
    // Read only a bounded fixed enum. Never accept a caller-supplied instruction.
    const tone = await readTasteTone(req).catch(() => null);
    if (!tone) return finish('invalid_tone', reply({ error: 'AI_TONE_INVALID' }, 400));
    perfTone = tone;
    const toneInstructions = tasteInstructions(TASTE_INSTRUCTIONS, tone);
    const promptVersion = tastePromptVersion(PROMPT_VERSION, tone);
    if (!serviceRole || !openAiKey) return finish('not_configured', reply({ error: 'AI_NOT_CONFIGURED' }, 503));

    const publicClient = createClient(url, anonKey, options);
    const admin = createClient(url, serviceRole, options);
    const { data: profile, error: profileError } = await publicClient
      .from('profiles').select('id').eq('id', user.id).maybeSingle();
    if (profileError) throw new Error('AI_PROFILE_READ_FAILED');
    if (!profile) return finish('forbidden', reply({ error: 'FORBIDDEN' }, 403));

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
      } catch { return PROFILE_AI_COOLDOWN_SECONDS; }
    };
    const readSnapshot = async () => {
      const { data, error } = await publicClient.from('picks')
        .select('id,one_line_review,updated_at,categories!picks_category_id_fkey!inner(name),items!picks_item_category_fk!inner(name,original_name,release_year,creator_name,collection_name)')
        .eq('user_id', user.id).eq('status', 'active').eq('categories.is_visible', true)
        .in('items.status', ['active', 'discontinued']).order('id', { ascending: true }).limit(50);
      if (error) throw new Error('AI_SOURCE_READ_FAILED');
      return buildSnapshot(data ?? []);
    };
    const sourceVersion = await readSourceVersion();
    const snapshot = await readSnapshot();
    if (snapshot.length < PROFILE_AI_MIN_PICKS) return finish('not_enough_picks', reply({
      error: 'AI_NOT_ENOUGH_PICKS', minimum: PROFILE_AI_MIN_PICKS,
      count: snapshot.length, remaining: PROFILE_AI_MIN_PICKS - snapshot.length,
    }, 409));
    if (await readSourceVersion() !== sourceVersion) return finish('stale', reply({ error: 'AI_REVIEW_STALE' }, 409));
    const tasteInput = buildTasteInput(snapshot);
    const sourceFingerprint = await fingerprint(snapshot);
    const { data: existing, error: existingError } = await admin.from('profile_ai_reviews')
      .select(`${REVIEW_COLUMNS},source_fingerprint,source_version,model_name,prompt_version`)
      .eq('profile_id', user.id).maybeSingle();
    if (existingError) throw new Error('AI_REVIEW_READ_FAILED');
    const { data: actor, error: actorError } = await admin.from('system_actors')
      .select(ACTOR_COLUMNS).eq('slug', 'onepick_ai').eq('is_active', true).single();
    if (actorError || !actor) throw new Error('AI_ACTOR_NOT_FOUND');

    // Same source but a DIFFERENT tone is not a cache hit. Only the latest
    // comment is stored, and both modes share the existing per-profile limit.
    if (existing && !existing.is_stale && Number(existing.source_version) === sourceVersion &&
      existing.source_fingerprint === sourceFingerprint && existing.tone === tone &&
      existing.model_name === MODEL && existing.prompt_version === promptVersion) {
      if (await readSourceVersion() !== sourceVersion) return finish('stale', reply({ error: 'AI_REVIEW_STALE' }, 409));
      const { source_fingerprint: _fingerprint, source_version: _version,
        model_name: _model, prompt_version: _prompt, ...review } = existing;
      assertNoAgeComment(review);
      return finish('reused', reply({ review, actor, reused: true }));
    }
    if (existing?.generated_at) {
      const elapsedMs = Date.now() - new Date(existing.generated_at).getTime();
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < COOLDOWN_MS) return finish('rate_limited', reply({
        error: 'RATE_LIMITED', retryAfterSeconds: Math.max(1, Math.ceil((COOLDOWN_MS - elapsedMs) / 1000)),
      }, 429));
    }
    const { data: reserved, error: reservationError } = await admin
      .rpc('reserve_profile_ai_generation', { p_profile_id: user.id });
    if (reservationError) throw new Error('AI_RESERVATION_FAILED');
    if (reserved !== true) return finish('rate_limited', reply({ error: 'RATE_LIMITED', retryAfterSeconds: await readRetryAfterSeconds() }, 429));
    retryAfterReservation = await readRetryAfterSeconds();

    providerStartedAt = performance.now();
    const modelResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, store: false, reasoning: { effort: 'low' }, max_output_tokens: 1600,
        instructions: toneInstructions,
        input: JSON.stringify(tasteInput),
        text: { format: {
          type: 'json_schema', name: 'onepick_taste_profile', strict: true,
          schema: {
            type: 'object', properties: {
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
      providerFinishedAt = performance.now();
      console.error('AI_PROVIDER_FAILED', modelResponse.status);
      await modelResponse.body?.cancel();
      return finish('provider_failed', reply({ error: 'AI_REVIEW_FAILED', retryAfterSeconds: retryAfterReservation }, 502));
    }
    const output = outputText(await modelResponse.json());
    if (!output) throw new Error('AI_REVIEW_EMPTY_OR_REFUSED');
    const generated = cleanResult(JSON.parse(output));
    assertNoAgeComment(generated);
    providerFinishedAt = performance.now();
    saveStartedAt = performance.now();
    const latestSnapshot = await readSnapshot();
    if (await fingerprint(latestSnapshot) !== sourceFingerprint) {
      saveFinishedAt = performance.now();
      return finish('stale', reply({ error: 'AI_REVIEW_STALE', retryAfterSeconds: retryAfterReservation }, 409));
    }
    // Existing DB function keeps its source-version lock, one latest row and
    // private default. The generated tone column follows its server-only version.
    const { data: saved, error: saveError } = await admin.rpc('save_profile_ai_review', {
      p_profile_id: user.id, p_source_version: sourceVersion, p_actor_id: actor.id,
      p_summary: generated.summary, p_body: generated.body, p_keywords: generated.keywords,
      p_pick_snapshot: snapshot, p_source_fingerprint: sourceFingerprint,
      p_model_name: MODEL, p_prompt_version: promptVersion,
    });
    saveFinishedAt = performance.now();
    if (saveError?.message === 'AI_REVIEW_STALE') return finish('stale', reply({ error: 'AI_REVIEW_STALE', retryAfterSeconds: retryAfterReservation }, 409));
    if (saveError || !saved || saved.tone !== tone) throw new Error('AI_REVIEW_SAVE_FAILED');
    return finish('generated', reply({ review: saved, actor, reused: false }));
  } catch {
    console.error('AI_REVIEW_FAILED');
    return finish('failed', reply(retryAfterReservation
      ? { error: 'AI_REVIEW_FAILED', retryAfterSeconds: retryAfterReservation }
      : { error: 'AI_REVIEW_FAILED' }, 500));
  }
});
