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
    return reply({ service: 'analyze-profile-taste', status: 'ok', configured });
  }
  if (req.method !== 'POST' || statusPath) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const value = req.headers.get('Authorization') ?? '';
  const match = value.length <= 8192 ? /^Bearer ([^\s]+)$/i.exec(value) : null;
  if (!match) return reply({ error: 'AUTH_REQUIRED' }, 401);
  // Syntax is NOT authentication. The handler must verify this token with getUser.
  return { authorization: `Bearer ${match[1]}` };
}
