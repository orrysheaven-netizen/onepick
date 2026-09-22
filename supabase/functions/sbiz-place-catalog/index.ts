import { createClient } from '@supabase/supabase-js';

const SBIZ_BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const MAX_ROWS = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

async function requireAdmin(req: Request, client: ReturnType<typeof adminClient>) {
  if (!client) return false;
  const authorization = req.headers.get('Authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return false;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return false;
  const { data: allowed, error: rpcError } = await client.rpc('current_user_is_admin');
  return !rpcError && allowed === true;
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
  const client = adminClient();
  if (!client) return json({ error: 'SERVER_NOT_CONFIGURED' }, 503);
  if (!(await requireAdmin(req, client))) return json({ error: 'ADMIN_REQUIRED' }, 403);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const requested = Number(body.limit ?? 20);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), MAX_ROWS) : 20;
  try {
    const rows = await fetchSeoul(limit);
    return json({ ok: true, provider: 'sbiz', region: '서울특별시', requested: limit, received: rows.length, rows });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'SBIZ_UNAVAILABLE';
    console.error('SBIZ fetch failed', code);
    return json({ error: code === 'SBIZ_NOT_CONFIGURED' ? code : 'SBIZ_UNAVAILABLE' }, code === 'SBIZ_NOT_CONFIGURED' ? 503 : 502);
  }
});
