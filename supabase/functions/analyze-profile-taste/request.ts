import {
  PROFILE_AI_CONTRACT_VERSION,
  PROFILE_AI_COOLDOWN_SECONDS,
  PROFILE_AI_MIN_CHANGES,
  PROFILE_AI_MIN_PICKS,
  PROFILE_AI_RECOMMENDED_PICKS,
  PROFILE_AI_REANALYSIS_INTERVAL_SECONDS,
} from './contract.ts';
import { TASTE_PROMPT_VERSION } from './quality.ts';

export type EnvReader = (name: string) => string | undefined;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

export const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

/** Status reports presence only, not provider validity, billing, or model access. */
export function inspectRequest(req: Request, env: EnvReader): Response | { authorization: string } {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const statusPath = new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/status');
  if (req.method === 'GET' && statusPath) {
    const configured = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']
      .every((name) => Boolean(env(name)?.trim()));
    // Never include key names/values, account details, or source data here.
    return reply({
      service: 'analyze-profile-taste', status: 'ok', configured,
      contractVersion: PROFILE_AI_CONTRACT_VERSION,
      minimumPicks: PROFILE_AI_MIN_PICKS,
      recommendedPicks: PROFILE_AI_RECOMMENDED_PICKS,
      minimumChanges: PROFILE_AI_MIN_CHANGES,
      reanalysisIntervalSeconds: PROFILE_AI_REANALYSIS_INTERVAL_SECONDS,
      promptVersion: TASTE_PROMPT_VERSION,
      cooldownSeconds: PROFILE_AI_COOLDOWN_SECONDS,
    });
  }
  if (req.method !== 'POST' || statusPath) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const value = req.headers.get('Authorization') ?? '';
  const match = value.length <= 8192 ? /^Bearer ([^\s]+)$/i.exec(value) : null;
  if (!match) return reply({ error: 'AUTH_REQUIRED' }, 401);
  // Syntax is NOT authentication. The handler must verify this token with getUser.
  return { authorization: `Bearer ${match[1]}` };
}
