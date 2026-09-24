// One-time QA account setup. Uses the same user-scoped insert as app onboarding.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const ORIGIN = 'https://ygoipwzakzdnkaaxyrgb.supabase.co';
const SITE = 'https://onepick-5cl.pages.dev';

export function isPublicKey(key) {
  if (typeof key !== 'string') return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon';
  } catch { return false; }
}

export async function setupProfile({ key, email, password, fetchImpl = fetch }) {
  if (!isPublicKey(key) || !email || !password) throw new Error('SETUP_INPUT_INVALID');
  let token;
  async function request(path, method = 'GET', data) {
    const response = await fetchImpl(`${ORIGIN}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { apikey: key, 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    // Never include response bodies, URLs, credentials, or raw errors in logs.
    if (!response.ok) throw new Error('SETUP_REQUEST_FAILED');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  try {
    const session = await request('/auth/v1/token?grant_type=password', 'POST', { email, password });
    token = session.access_token;
    if (!token) throw new Error('SETUP_AUTH_FAILED');
    const user = await request('/auth/v1/user');
    if (!/^[a-f0-9-]{36}$/i.test(user.id ?? '') || user.email?.toLowerCase() !== email.toLowerCase()) {
      throw new Error('SETUP_IDENTITY_MISMATCH');
    }
    if (await request('/rest/v1/rpc/current_user_is_admin', 'POST', {}) !== false) {
      throw new Error('SETUP_REQUIRES_GENERAL_USER');
    }
    const profilePath = `/rest/v1/profiles?id=eq.${user.id}&select=id,username`;
    const readOwn = () => request(profilePath);
    const existing = await readOwn();
    if (!Array.isArray(existing)) throw new Error('SETUP_PROFILE_READ_FAILED');
    if (existing.length) {
      if (existing.length !== 1 || existing[0].id !== user.id || !existing[0].username) {
        throw new Error('SETUP_EXISTING_PROFILE_INVALID');
      }
      return 'already-ready'; // Never rename or overwrite an existing profile.
    }
    const username = `qa_${createHash('sha256').update(user.id).digest('hex').slice(0, 12)}`;
    try {
      await request('/rest/v1/profiles', 'POST', {
        id: user.id, username, onboarding_completed: false,
      });
    } catch {
      // A concurrent insert or a lost response may have succeeded. Re-read our own row.
      const recovered = await readOwn();
      if (recovered.length !== 1 || recovered[0].id !== user.id || recovered[0].username !== username) {
        throw new Error('SETUP_PROFILE_CREATE_FAILED');
      }
    }
    const saved = await readOwn();
    if (saved.length !== 1 || saved[0].id !== user.id || saved[0].username !== username) {
      throw new Error('SETUP_PROFILE_VERIFY_FAILED');
    }
    return 'created';
  } finally {
    if (token) await request('/auth/v1/logout?scope=local', 'POST').catch(() => {
      throw new Error('SETUP_SESSION_CLEANUP_FAILED');
    });
  }
}

async function discoverPublicKey() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let key;
    page.on('request', request => {
      if (new URL(request.url()).origin === ORIGIN && isPublicKey(request.headers().apikey)) {
        key = request.headers().apikey;
      }
    });
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 30_000 });
    if (!key) throw new Error('SETUP_PUBLIC_KEY_NOT_FOUND');
    return key;
  } finally { await browser.close(); }
}

async function main() {
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main'
      || process.env.CONFIRM_QA_PROFILE_SETUP !== 'true'
      || !process.env.ONEPICK_QA_EMAIL || !process.env.ONEPICK_QA_PASSWORD) {
    throw new Error('SETUP_NOT_AUTHORIZED');
  }
  const result = await setupProfile({ key: await discoverPublicKey(),
    email: process.env.ONEPICK_QA_EMAIL, password: process.env.ONEPICK_QA_PASSWORD });
  console.log(result === 'created' ? 'QA profile created and verified.' : 'QA profile already ready; unchanged.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('QA profile setup failed. No credentials or response bodies are logged.');
    process.exitCode = 1;
  });
}
