import { createClient } from '@supabase/supabase-js';

const SBIZ_BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const MAX_ROWS = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function callerClient(authorization: string) {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function serviceKey() {
  return Deno.env.get('SBIZ_API_SERVICE_KEY')?.trim() || null;
}

function text(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function number(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRow(row: Record<string, unknown>) {
  const id = text(row.bizesId ?? row.bizesIdNm ?? row.storeId);
  const name = text(row.bizesNm ?? row.storeNm);
  if (!id || !name) return null;
  return {
    provider_place_id: id,
    payload: {
      name,
      branch_name: text(row.brchNm),
      road_address: text(row.rdnmAdr),
      address: text(row.lnoAdr),
      region_1: text(row.ctprvnNm),
      region_2: text(row.signguNm),
      longitude: number(row.lon),
      latitude: number(row.lat),
      provider_category: text(row.indsSclsNm ?? row.indsMclsNm),
      business_status: 'open',
    },
  };
}

type AdminAuthResult = 'ok' | 'server_not_configured' | 'admin_required';

async function requireAdmin(req: Request): Promise<AdminAuthResult> {
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return 'admin_required';

  const client = callerClient(authorization);
  if (!client) return 'server_not_configured';

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return 'admin_required';

  // Admin data paths in OnePick require an MFA-stepped-up session. Supplying
  // the JWT explicitly is the server-side form recommended by Supabase.
  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel(token);
  if (assuranceError || assurance.currentLevel !== 'aal2') return 'admin_required';

  // This RPC reads auth.uid(). The client must therefore carry the caller's
  // Authorization header; a service-role client would erase the caller context.
  const { data: allowed, error: rpcError } = await client.rpc('current_user_is_admin');
  return !rpcError && allowed === true ? 'ok' : 'admin_required';
}

async function fetchSeoul(rows: number) {
  const key = serviceKey();
  if (!key) throw new Error('SBIZ_NOT_CONFIGURED');
  const url = new URL(SBIZ_BASE + '/storeListInDong');
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('divId', 'ctprvnCd');
  url.searchParams.set('key', '11');
  url.searchParams.set('numOfRows', String(rows));
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('type', 'json');
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('SBIZ_UNAVAILABLE');
  const body = await response.json() as Record<string, unknown>;
  const bodyNode = body.body as Record<string, unknown> | undefined;
  const itemsNode = bodyNode?.items as Record<string, unknown> | unknown[] | undefined;
  const raw = Array.isArray(itemsNode)
    ? itemsNode
    : Array.isArray((itemsNode as Record<string, unknown> | undefined)?.item)
      ? (itemsNode as Record<string, unknown>).item as unknown[]
      : [];
  return raw.map((row) => mapRow(row as Record<string, unknown>)).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const auth = await requireAdmin(req);
  if (auth === 'server_not_configured') return json({ error: 'SERVER_NOT_CONFIGURED' }, 503);
  if (auth !== 'ok') return json({ error: 'ADMIN_MFA_REQUIRED' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const requested = Number(body.limit ?? 20);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_ROWS) : 20;

  try {
    const rows = await fetchSeoul(limit);
    return json({ ok: true, provider: 'sbiz', region: '서울특별시', requested: limit, received: rows.length, rows });
  } catch (error) {
    const configured = error instanceof Error && error.message === 'SBIZ_NOT_CONFIGURED';
    console.error('SBIZ fetch failed', error instanceof Error ? error.name : 'unknown');
    return json(
      { error: configured ? 'SBIZ_NOT_CONFIGURED' : 'SBIZ_UNAVAILABLE' },
      configured ? 503 : 502,
    );
  }
});
