const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Reduced accessible DOM from main's profile, registration and notification screens.
// No server, credentials or app/AI endpoint is contacted; all URLs are intercepted.
test('logged-in QA contracts against isolated UI states', async (t) => {
  const api = await import('./logged-in-contract.mjs');
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH
    ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let unexpectedRequests = 0;
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).hostname === 'fixture.invalid') {
      await route.fulfill({ contentType: 'text/html', body: '<body></body>' });
    } else {
      unexpectedRequests += 1;
      await route.abort();
    }
  });
  const page = await context.newPage();
  const timeout = 400;
  const set = async (html) => { await page.goto('https://fixture.invalid/profile'); await page.setContent(html); };
  try {
    await t.test('identity belongs to authenticated user, not another visible profile', async () => {
      assert.equal(api.ownProfileUsername([{ id: 'other', username: 'stranger' }, { id: 'qa', username: 'qa_user' }], 'qa'), 'qa_user');
      assert.throws(() => api.ownProfileUsername([{ id: 'other', username: 'qa_user' }], 'qa'));
      assert.throws(() => api.ownProfileUsername({ id: 'qa', username: '' }, 'qa'));
      await set('<div>qa_user</div><button>설정 열기</button><button>내 댓글 보기</button><button aria-label="음식 원픽 보기">음식</button>');
      await api.assertOwnProfile(page, 'qa_user', timeout);
      await assert.rejects(api.assertOwnProfile(page, 'stranger', timeout));
      await set('<div>qa_user</div><button>로그인하기</button>');
      await assert.rejects(api.assertOwnProfile(page, 'qa_user', timeout));
    });
    await t.test('public profile accepts the current food control and rejects legacy or hidden controls', async () => {
      const food = '<button aria-label="음식 원픽 보기">음식</button>';
      await set(`${food}<div>아직 공개된 음식 원픽이 없어요</div>`);
      await api.assertPublicProfile(page, timeout);
      await set(`<div hidden>${food}</div>${food}<div>공개 원픽 목록</div>`);
      await api.assertPublicProfile(page, timeout);
      for (const label of ['현재 원픽', '음식 원픽']) {
        await set(`<div hidden>${food}</div><div>${label}</div>`);
        await assert.rejects(api.assertPublicProfile(page, timeout));
      }
    });
    await t.test('profile comments and notification tab really navigate', async () => {
      await set('<button onclick="history.pushState({}, \'\', \'/comments\')">내 댓글 보기</button>');
      await api.openOwnComments(page, timeout);
      assert.equal(new URL(page.url()).pathname, '/comments');
      for (const role of ['link', 'tab']) {
        await set(`<button role="${role}" onclick="history.pushState({}, '', '/notifications')">알림</button>`);
        await api.openNotificationsTab(page, timeout);
      }
      await set('<button>내 댓글 보기</button>');
      await assert.rejects(api.openOwnComments(page, timeout));
    });
    const menu = (label, disabled = false) => `<div>2 / 4 · 매장</div><input aria-label="메뉴 이름"><button onclick="window.selected=true">${label}</button><button ${disabled ? 'disabled' : ''} onclick="window.submitted=true">다음</button>`;
    await t.test('menu supports plain/group names, default AI path, and trial-only Next', async () => {
      for (const label of ['도가니탕', '국물 › 도가니탕', 'AI 추천 도가니탕']) {
        await set(menu(label));
        await api.checkMenuSelection(page, '도가니탕', timeout);
        assert.equal(await page.evaluate(() => window.selected), true);
        assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
      }
      await set(menu('국물 › 메뉴(특)+'));
      await api.checkMenuSelection(page, '메뉴(특)+', timeout, false);
      await set(menu('AI 추천 도가니탕'));
      await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout, false));
      await set(menu('다른 메뉴'));
      await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout));
      await set(menu('도가니탕', true));
      await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout, false), (error) => error.code !== 'QA_MENU_CHOICE_UNAVAILABLE');
      await set('<div>2 / 4 · 매장</div><input aria-label="메뉴 검색"><button>도가니탕</button><button>도가니탕(으)로 다음</button>');
      await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout));
    });
    await t.test('notifications require signed-in controls and a loaded list or empty state', async () => {
      for (const row of ['새 알림, @user, 댓글', '읽은 알림, 수정 필요']) {
        await set(`<h1>알림</h1><button>새로고침</button><button>${row}</button>`);
        assert.equal(await api.assertNotifications(page, timeout), 1);
      }
      await set('<h1>알림</h1><button>새로고침</button><div>아직 알림이 없어요</div>');
      assert.equal(await api.assertNotifications(page, timeout), 0);
      await set('<h1>알림</h1><button>로그인</button>');
      await assert.rejects(api.assertNotifications(page, timeout), /비로그인/);
      await set('<h1>알림</h1><button>새로고침</button><div>알림을 불러오고 있어요.</div>');
      await assert.rejects(api.assertNotifications(page, timeout));
    });
    await t.test('safe-mode suggestion route aborts instead of fabricating a recommendation', async () => {
      let blocked = 0;
      await context.route(api.SUGGESTION_ROUTE, async (route) => { blocked += 1; await route.abort(); });
      await set('<body></body>');
      const result = await page.evaluate(async () => {
        try { await fetch('https://fixture.invalid/functions/v1/suggest-item-categories', { method: 'POST' }); return 'unexpected success'; }
        catch { return 'blocked'; }
      });
      assert.equal(result, 'blocked');
      assert.equal(blocked, 1);
    });
    assert.equal(unexpectedRequests, 0);
  } finally { await browser.close(); }
});
