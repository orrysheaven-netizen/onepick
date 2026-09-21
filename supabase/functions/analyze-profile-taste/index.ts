import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import {
  PROFILE_AI_COOLDOWN_SECONDS,
  PROFILE_AI_MIN_CHANGES,
  PROFILE_AI_MIN_PICKS,
  PROFILE_AI_RECOMMENDED_PICKS,
  PROFILE_AI_REANALYSIS_INTERVAL_SECONDS,
} from './contract.ts';
import { inspectRequest, reply } from './request.ts';
import { logProfileAiServerPerformance, type ProfileAiServerOutcome } from './performance.ts';
import {
  assertNoAgeComment, buildTasteInput, TASTE_INSTRUCTIONS, TASTE_PROMPT_VERSION,
  type PopularityEntry, type PopularityMap,
} from './quality.ts';
import { readTasteTone, tasteInstructions, tastePromptVersion } from './tone.ts';

const MODEL = 'gpt-5.6-terra';
const PROMPT_VERSION = TASTE_PROMPT_VERSION;
const COOLDOWN_MS = PROFILE_AI_COOLDOWN_SECONDS * 1000;
const REANALYSIS_INTERVAL_MS = PROFILE_AI_REANALYSIS_INTERVAL_SECONDS * 1000;
const REVIEW_COLUMNS = 'id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,created_at,updated_at,tone,pick_snapshot';
const ACTOR_COLUMNS = 'id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function textOrNull(value: unknown, maximum = 300) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : null;
}
function buildSnapshot(rows: unknown[]) {
  return rows.map((value) => {
    const pick = record(value);
    return {
      pickId: textOrNull(pick.pick_id, 36),
      categoryId: textOrNull(pick.category_id, 36),
      category: textOrNull(pick.category_name),
      itemId: textOrNull(pick.item_id, 36),
      item: textOrNull(pick.item_name),
      originalName: textOrNull(pick.item_original_name),
      releaseYear: typeof pick.item_release_year === 'number' ? pick.item_release_year : null,
      creatorName: textOrNull(pick.item_creator_name), collectionName: textOrNull(pick.item_collection_name),
      review: textOrNull(pick.one_line_review, 100), updatedAt: textOrNull(pick.updated_at, 40),
    };
  }).filter((pick) =>
    pick.pickId && pick.categoryId && pick.category && pick.itemId && pick.item && pick.review
  );
}

function meaningfulChangeCount(previousValue: unknown, currentValue: unknown): number {
  const previous = Array.isArray(previousValue) ? previousValue.map(record) : [];
  const current = Array.isArray(currentValue) ? currentValue.map(record) : [];

  const signatureByCategory = (rows: Record<string, unknown>[]) => {
    const result = new Map<string, string>();
    for (const row of rows) {
      const categoryId = textOrNull(row.categoryId, 36);
      const category = textOrNull(row.category, 300);
      const key = categoryId ?? (category ? `name:${category}` : null);
      if (!key) continue;

      const itemId = textOrNull(row.itemId, 36);
      const item = textOrNull(row.item, 300);
      const review = textOrNull(row.review, 100) ?? '';
      const itemKey = itemId ?? (item ? `name:${item}` : '');
      result.set(key, JSON.stringify([itemKey, review]));
    }
    return result;
  };

  const before = signatureByCategory(previous);
  const after = signatureByCategory(current);
  const keys = new Set([...before.keys(), ...after.keys()]);
  let changed = 0;
  for (const key of keys) {
    if (before.get(key) !== after.get(key)) changed += 1;
  }
  return changed;
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
  let reservationGrantedAt: number | null = null;
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
    // profile_taste_picks carries the same conditions this read used to spell
    // out, plus the taste-dimension requirement, and profile-ai-status calls
    // the very same function for its gate. Categories with no primary taste
    // dimension — living-service 단골 among them — are not taste material and
    // stay out of both. The function is security invoker, so this keeps
    // reading as the public client against the public-pick policy.
    const readSnapshot = async () => {
      const { data, error } = await publicClient.rpc('profile_taste_picks', { p_profile_id: user.id });
      if (error) throw new Error('AI_SOURCE_READ_FAILED');
      return buildSnapshot(data ?? []);
    };
    // Community-wide, not scoped to this user; safe on the anon-keyed client
    // since picks_public_active_read already makes every active pick public.
    const readPopularity = async (rows: ReturnType<typeof buildSnapshot>): Promise<PopularityMap> => {
      const itemIds = [...new Set(rows.map((row) => row.itemId).filter((id): id is string => !!id))];
      if (itemIds.length === 0) return new Map();
      const { data, error } = await publicClient.rpc('profile_ai_pick_popularity', { p_item_ids: itemIds });
      if (error) throw new Error('AI_POPULARITY_READ_FAILED');
      const map = new Map<string, PopularityEntry>();
      for (const value of (data ?? [])) {
        const row = record(value);
        const itemId = textOrNull(row.item_id, 36);
        if (!itemId) continue;
        map.set(itemId, {
          itemPickCount: Number(row.item_pick_count) || 0,
          categoryPickCount: Number(row.category_pick_count) || 0,
          rankingMinSample: Number(row.ranking_min_sample) || 0,
        });
      }
      return map;
    };
    // Read the public-profile gate and the initial source version together.
    // The snapshot still follows the initial version read so a second version
    // read can detect changes that committed while the snapshot was being read.
    const [profileResult, sourceVersion] = await Promise.all([
      publicClient.from('profiles').select('id').eq('id', user.id).maybeSingle(),
      readSourceVersion(),
    ]);
    const { data: profile, error: profileError } = profileResult;
    if (profileError) throw new Error('AI_PROFILE_READ_FAILED');
    if (!profile) return finish('forbidden', reply({ error: 'FORBIDDEN' }, 403));

    const snapshot = await readSnapshot();
    if (snapshot.length < PROFILE_AI_MIN_PICKS) return finish('not_enough_picks', reply({
      error: 'AI_NOT_ENOUGH_PICKS', minimum: PROFILE_AI_MIN_PICKS,
      count: snapshot.length, remaining: PROFILE_AI_MIN_PICKS - snapshot.length,
    }, 409));

    // These reads are independent once a valid public snapshot exists. Running
    // them together removes serial PostgREST round trips without weakening
    // the source-version check or public snapshot RLS. current_user_is_admin
    // reads auth.uid() from the caller's own JWT, so it must run on userClient
    // (publicClient/admin carry no real end-user identity).
    const [latestSourceVersion, existingResult, actorResult, adminResult] = await Promise.all([
      readSourceVersion(),
      admin.from('profile_ai_reviews')
        .select(`${REVIEW_COLUMNS},source_fingerprint,source_version,model_name,prompt_version`)
        .eq('profile_id', user.id).maybeSingle(),
      admin.from('system_actors')
        .select(ACTOR_COLUMNS).eq('slug', 'onepick_ai').eq('is_active', true).single(),
      userClient.rpc('current_user_is_admin'),
    ]);
    if (latestSourceVersion !== sourceVersion) return finish('stale', reply({ error: 'AI_REVIEW_STALE' }, 409));
    const { data: existing, error: existingError } = existingResult;
    if (existingError) throw new Error('AI_REVIEW_READ_FAILED');
    const { data: actor, error: actorError } = actorResult;
    if (actorError || !actor) throw new Error('AI_ACTOR_NOT_FOUND');
    if (adminResult.error) throw new Error('AI_ADMIN_CHECK_FAILED');
    const isAdmin = adminResult.data === true;

    const sourceFingerprint = await fingerprint(snapshot);

    // Same source but a DIFFERENT tone is not a cache hit. Only the latest
    // comment is stored, and both modes share the existing per-profile limit.
    if (existing && !existing.is_stale && Number(existing.source_version) === sourceVersion &&
      existing.source_fingerprint === sourceFingerprint && existing.tone === tone &&
      existing.model_name === MODEL && existing.prompt_version === promptVersion) {
      if (await readSourceVersion() !== sourceVersion) return finish('stale', reply({ error: 'AI_REVIEW_STALE' }, 409));
      const { pick_snapshot: _snapshot, source_fingerprint: _fingerprint, source_version: _version,
        model_name: _model, prompt_version: _prompt, ...review } = existing;
      assertNoAgeComment(review);
      return finish('reused', reply({ review, actor, reused: true }));
    }
    if (existing) {
      const previousPickCount = Array.isArray(existing.pick_snapshot) ? existing.pick_snapshot.length : 0;

      // The first result is intentionally available early at five picks. Once the
      // profile reaches ten, allow one immediate quality upgrade without making
      // the user wait out the daily cooldown. Until then, keep showing the existing result.
      if (previousPickCount < PROFILE_AI_RECOMMENDED_PICKS) {
        if (snapshot.length < PROFILE_AI_RECOMMENDED_PICKS) {
          return finish('waiting_for_ten', reply({
            error: 'AI_WAIT_FOR_TEN_PICKS',
            minimum: PROFILE_AI_RECOMMENDED_PICKS,
            count: snapshot.length,
            remaining: PROFILE_AI_RECOMMENDED_PICKS - snapshot.length,
          }, 409));
        }
      } else {
        const changedCount = meaningfulChangeCount(existing.pick_snapshot, snapshot);
        if (changedCount < PROFILE_AI_MIN_CHANGES) {
          return finish('not_enough_changes', reply({
            error: 'AI_NOT_ENOUGH_CHANGES',
            minimum: PROFILE_AI_MIN_CHANGES,
            count: changedCount,
            remaining: PROFILE_AI_MIN_CHANGES - changedCount,
          }, 409));
        }

        // Admins skip the elapsed-time cooldown only — they still need the
        // pick-count and changed-picks gates above like everyone else.
        if (!isAdmin && existing.generated_at) {
          const elapsedMs = Date.now() - new Date(existing.generated_at).getTime();
          if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < REANALYSIS_INTERVAL_MS) {
            return finish('rate_limited', reply({
              error: 'RATE_LIMITED',
              reason: 'DAILY_REANALYSIS_LIMIT',
              retryAfterSeconds: Math.max(1, Math.ceil((REANALYSIS_INTERVAL_MS - elapsedMs) / 1000)),
              minimumChanges: PROFILE_AI_MIN_CHANGES,
              changedCount,
            }, 429));
          }
        }
      }
    }
    const { data: reserved, error: reservationError } = await admin
      .rpc('reserve_profile_ai_generation', { p_profile_id: user.id });
    if (reservationError) throw new Error('AI_RESERVATION_FAILED');
    if (reserved !== true) return finish('rate_limited', reply({
      error: 'RATE_LIMITED', retryAfterSeconds: await readRetryAfterSeconds(),
    }, 429));
    // A successful reservation always writes now + the fixed cooldown. Track
    // elapsed function time locally instead of issuing another DB read.
    reservationGrantedAt = Date.now();
    const reservedRetryAfterSeconds = () => Math.max(1, Math.min(
      PROFILE_AI_COOLDOWN_SECONDS,
      Math.ceil((COOLDOWN_MS - Math.max(0, Date.now() - reservationGrantedAt!)) / 1000),
    ));

    const popularity = await readPopularity(snapshot);
    const tasteInput = buildTasteInput(snapshot, popularity);

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
      return finish('provider_failed', reply({
        error: 'AI_REVIEW_FAILED', retryAfterSeconds: reservedRetryAfterSeconds(),
      }, 502));
    }
    const output = outputText(await modelResponse.json());
    if (!output) throw new Error('AI_REVIEW_EMPTY_OR_REFUSED');
    const generated = cleanResult(JSON.parse(output));
    assertNoAgeComment(generated);
    providerFinishedAt = performance.now();
    saveStartedAt = performance.now();
    // save_profile_ai_review locks the same source-version row updated by every
    // relevant pick/item/category invalidation. That authoritative check makes a
    // second full public snapshot read after the model call redundant.
    const { data: saved, error: saveError } = await admin.rpc('save_profile_ai_review', {
      p_profile_id: user.id, p_source_version: sourceVersion, p_actor_id: actor.id,
      p_summary: generated.summary, p_body: generated.body, p_keywords: generated.keywords,
      p_pick_snapshot: snapshot, p_source_fingerprint: sourceFingerprint,
      p_model_name: MODEL, p_prompt_version: promptVersion,
    });
    saveFinishedAt = performance.now();
    if (saveError?.message === 'AI_REVIEW_STALE') return finish('stale', reply({
      error: 'AI_REVIEW_STALE', retryAfterSeconds: reservedRetryAfterSeconds(),
    }, 409));
    if (saveError || !saved || saved.tone !== tone) throw new Error('AI_REVIEW_SAVE_FAILED');
    return finish('generated', reply({ review: saved, actor, reused: false }));
  } catch {
    console.error('AI_REVIEW_FAILED');
    const retryAfterSeconds = reservationGrantedAt === null ? null : Math.max(1, Math.min(
      PROFILE_AI_COOLDOWN_SECONDS,
      Math.ceil((COOLDOWN_MS - Math.max(0, Date.now() - reservationGrantedAt)) / 1000),
    ));
    return finish('failed', reply(retryAfterSeconds
      ? { error: 'AI_REVIEW_FAILED', retryAfterSeconds }
      : { error: 'AI_REVIEW_FAILED' }, 500));
  }
});
