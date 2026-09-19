import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const MODEL = 'gpt-5.6-terra';
const PROMPT_VERSION = 'taste-v1';
const MIN_PICKS = 3;
const COOLDOWN_MS = 10 * 60 * 1000;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

function outputText(payload: any) {
  for (const item of payload?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return null;
}

async function fingerprint(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanResult(value: any) {
  const summary = typeof value?.summary === 'string' ? value.summary.trim() : '';
  const body = typeof value?.body === 'string' ? value.body.trim() : '';
  const keywords = Array.isArray(value?.keywords)
    ? value.keywords.filter((item: unknown) => typeof item === 'string')
      .map((item: string) => item.trim())
      .filter(Boolean)
      .slice(0, 5)
    : [];

  if (!summary || summary.length > 180 || !body || body.length > 1200 || keywords.length < 3) {
    throw new Error('AI_REVIEW_INVALID');
  }
  return { summary, body, keywords };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply({ error: 'AUTH_REQUIRED' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!url || !anonKey || !serviceRole) return reply({ error: 'AI_REVIEW_FAILED' }, 500);
  if (!openAiKey) return reply({ error: 'AI_NOT_CONFIGURED' }, 503);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authError } =
    await userClient.auth.getUser(authorization.slice(7));
  if (authError || !user) return reply({ error: 'AUTH_REQUIRED' }, 401);

  try {
    const { data: picks, error: picksError } = await admin
      .from('picks')
      .select('id,category_id,item_id,one_line_review,updated_at,categories(name),items(name,original_name,release_year,creator_name,collection_name)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('updated_at', { ascending: true })
      .limit(50);
    if (picksError) throw picksError;
    if ((picks?.length ?? 0) < MIN_PICKS) {
      return reply({ error: 'AI_NOT_ENOUGH_PICKS', minimum: MIN_PICKS }, 409);
    }

    const snapshot = (picks ?? []).map((pick: any) => ({
      pickId: pick.id,
      category: pick.categories?.name ?? null,
      item: pick.items?.name ?? null,
      originalName: pick.items?.original_name ?? null,
      releaseYear: pick.items?.release_year ?? null,
      creatorName: pick.items?.creator_name ?? null,
      collectionName: pick.items?.collection_name ?? null,
      review: pick.one_line_review,
      updatedAt: pick.updated_at,
    }));
    const sourceFingerprint = await fingerprint(snapshot);

    const { data: existing, error: existingError } = await admin
      .from('profile_ai_reviews')
      .select('id,profile_id,actor_id,summary,body,keywords,is_visible,generated_at,created_at,updated_at,source_fingerprint')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (existingError) throw existingError;

    const { data: actor, error: actorError } = await admin
      .from('system_actors')
      .select('id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at')
      .eq('slug', 'onepick_ai')
      .eq('is_active', true)
      .single();
    if (actorError || !actor) throw actorError ?? new Error('AI_ACTOR_NOT_FOUND');

    if (existing?.source_fingerprint === sourceFingerprint) {
      const { source_fingerprint: _hidden, ...review } = existing;
      return reply({ review, actor, reused: true });
    }

    if (existing?.generated_at) {
      const age = Date.now() - new Date(existing.generated_at).getTime();
      if (Number.isFinite(age) && age >= 0 && age < COOLDOWN_MS) {
        return reply({ error: 'RATE_LIMITED', retryAfterSeconds: Math.ceil((COOLDOWN_MS - age) / 1000) }, 429);
      }
    }

    const modelResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 600,
        instructions: [
          'You are OnePick AI. Analyze only the user’s explicitly provided OnePick selections and one-line reviews.',
          'Write in Korean.',
          'Interpret taste patterns, not the person’s hidden identity or psychological state.',
          'Never infer or mention health, mental health, disability, race, ethnicity, nationality, religion, political beliefs, sexual orientation, sex life, finances, criminal history, intelligence, diagnoses, or other sensitive personal traits.',
          'Do not make deterministic personality claims. Use tentative language such as “~을 선호하는 경향이 보여요” or “선택에서 ~가 드러납니다”.',
          'Find cross-category patterns grounded in the supplied selections. Do not invent facts about items.',
          'Keep the tone concise, observant, and slightly playful. No flattery for its own sake.',
          'Return a short summary, a 2–4 sentence body, and exactly 3 concise taste keywords.',
        ].join('\n'),
        input: JSON.stringify({ picks: snapshot }),
        text: {
          format: {
            type: 'json_schema',
            name: 'onepick_taste_profile',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                summary: { type: 'string', minLength: 1, maxLength: 180 },
                body: { type: 'string', minLength: 1, maxLength: 1200 },
                keywords: {
                  type: 'array',
                  items: { type: 'string', minLength: 1, maxLength: 24 },
                  minItems: 3,
                  maxItems: 3,
                },
              },
              required: ['summary', 'body', 'keywords'],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!modelResponse.ok) {
      console.error('OpenAI request failed', modelResponse.status, await modelResponse.text());
      return reply({ error: 'AI_REVIEW_FAILED' }, 502);
    }

    const payload = await modelResponse.json();
    const text = outputText(payload);
    if (!text) throw new Error('AI_REVIEW_EMPTY');
    const generated = cleanResult(JSON.parse(text));

    const now = new Date().toISOString();
    const { data: saved, error: saveError } = await admin
      .from('profile_ai_reviews')
      .upsert({
        profile_id: user.id,
        actor_id: actor.id,
        summary: generated.summary,
        body: generated.body,
        keywords: generated.keywords,
        pick_snapshot: snapshot,
        source_fingerprint: sourceFingerprint,
        model_name: MODEL,
        prompt_version: PROMPT_VERSION,
        is_visible: existing?.is_visible ?? true,
        generated_at: now,
      }, { onConflict: 'profile_id' })
      .select('id,profile_id,actor_id,summary,body,keywords,is_visible,generated_at,created_at,updated_at')
      .single();
    if (saveError || !saved) throw saveError ?? new Error('AI_REVIEW_SAVE_FAILED');

    return reply({ review: saved, actor, reused: false });
  } catch (error) {
    console.error('analyze-profile-taste failed', error);
    return reply({ error: 'AI_REVIEW_FAILED' }, 500);
  }
});
