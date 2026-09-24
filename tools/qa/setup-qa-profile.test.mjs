import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, isPublicKey, setupProfile } from './setup-qa-profile.mjs';

const id = '00000000-0000-4000-8000-000000000001';
function fixture({ existing, admin = false, collision = false, lostResponse = false, badIdentity = false } = {}) {
  let row = existing;
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).origin, ORIGIN);
    assert.equal(init.redirect, 'error');
    const path = new URL(url).pathname;
    calls.push({ path, method: init.method });
    const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
    if (path === '/auth/v1/token') return reply({ access_token: 'test-token' });
    assert.equal(init.headers.authorization, 'Bearer test-token');
    if (path === '/auth/v1/user') return reply({ id, email: badIdentity ? 'other@example.invalid' : 'qa@example.invalid' });
    if (path.endsWith('/current_user_is_admin')) return reply(admin);
    if (path === '/auth/v1/logout') { assert.equal(new URL(url).search, '?scope=local'); return reply(undefined, 204); }
    if (path === '/rest/v1/profiles' && init.method === 'GET') {
      assert.equal(new URL(url).searchParams.get('id'), `eq.${id}`);
      return reply(row ? [row] : []);
    }
    if (path === '/rest/v1/profiles' && init.method === 'POST') {
      const data = JSON.parse(init.body);
      assert.equal(data.id, id);
      assert.equal(data.onboarding_completed, false);
      assert.match(data.username, /^qa_[a-f0-9]{12}$/);
      assert.deepEqual(Object.keys(data).sort(), ['id', 'onboarding_completed', 'username']);
      if (collision) return reply({ error: 'private server message' }, 409);
      row = data;
      if (lostResponse) throw new Error('sensitive transport detail');
      return reply(undefined, 201);
    }
    throw new Error('Unexpected request');
  };
  return { calls, options: { key: 'sb_publishable_test', email: 'qa@example.invalid', password: 'test-password', fetchImpl } };
}

test('creates and verifies only own profile; logs out current session', async () => {
  const f = fixture();
  assert.equal(await setupProfile(f.options), 'created');
  assert.equal(f.calls.filter(x => x.path === '/rest/v1/profiles' && x.method === 'POST').length, 1);
  assert.equal(f.calls.at(-1).path, '/auth/v1/logout');
});
test('existing profile is preserved without writes', async () => {
  const f = fixture({ existing: { id, username: 'existing_qa' } });
  assert.equal(await setupProfile(f.options), 'already-ready');
  assert.equal(f.calls.filter(x => x.path === '/rest/v1/profiles' && x.method !== 'GET').length, 0);
});
test('admin account refused before profile access', async () => {
  const f = fixture({ admin: true });
  await assert.rejects(setupProfile(f.options), /SETUP_REQUIRES_GENERAL_USER/);
  assert.equal(f.calls.some(x => x.path === '/rest/v1/profiles'), false);
  assert.equal(f.calls.at(-1).path, '/auth/v1/logout');
});
test('mismatched identity refused and session cleaned up', async () => {
  const f = fixture({ badIdentity: true });
  await assert.rejects(setupProfile(f.options), /SETUP_IDENTITY_MISMATCH/);
  assert.equal(f.calls.some(x => x.path === '/rest/v1/profiles'), false);
  assert.equal(f.calls.at(-1).path, '/auth/v1/logout');
});
test('username collision fails without overwriting or leaking server body', async () => {
  const f = fixture({ collision: true });
  await assert.rejects(setupProfile(f.options), { message: 'SETUP_PROFILE_CREATE_FAILED' });
  assert.equal(f.calls.some(x => x.method === 'PATCH' || x.method === 'DELETE'), false);
});
test('lost successful response is recovered by own-profile read, no second insert', async () => {
  const f = fixture({ lostResponse: true });
  assert.equal(await setupProfile(f.options), 'created');
  assert.equal(f.calls.filter(x => x.path === '/rest/v1/profiles' && x.method === 'POST').length, 1);
});
test('missing credentials and privileged keys rejected before any request', async () => {
  const f = fixture();
  for (const options of [{ ...f.options, password: '' }, { ...f.options, key: 'sb_secret_test' }]) {
    await assert.rejects(setupProfile(options), /SETUP_INPUT_INVALID/);
  }
  assert.equal(f.calls.length, 0);
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(isPublicKey(jwt('service_role')), false);
  assert.equal(isPublicKey(jwt('anon')), true);
});
