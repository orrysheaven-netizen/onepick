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
      await set(`${food}<div>아직 고른 원픽이 없어요</div>`);
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
    await t.test('home search follows the dialog contract and scopes results to the dialog', async () => {
      await set(`<button aria-label="메뉴 검색" onclick="document.getElementById('search-dialog').hidden=false">열기</button>
        <button aria-label="홈 카드 상세 보기">홈 카드</button>
        <div id="search-dialog" hidden>
          <h2>어떤 메뉴를 찾으세요?</h2>
          <input aria-label="메뉴명">
          <button onclick="window.searched=true">검색하기</button>
          <button aria-label="라면 상세 보기" onclick="history.pushState({}, '', '/item/ramen')">라면</button>
        </div>`);
      await api.openHomeSearch(page, timeout);
      const results = await api.submitHomeSearch(page, '라면', timeout);
      assert.equal(await page.getByRole('textbox', { name: '메뉴명' }).inputValue(), '라면');
      assert.equal(await page.evaluate(() => window.searched), true);
      assert.equal(await results.count(), 1, 'Home cards behind the modal are not search results');
      await results.first().click();
      await page.waitForURL(/\/item\/ramen$/);
      await set('<input aria-label="항목명 검색"><button>검색 실행</button>');
      await assert.rejects(api.openHomeSearch(page, timeout));
    });
    await t.test('registration fixture keeps link-first fallback before store search', async () => {
      await set(`<div>1 / 4 · 오프라인 매장</div>
        <h1 id="title">네이버 지도 링크를 입력해주세요.</h1>
        <input aria-label="매장 찾기 네이버 지도 링크">
        <button aria-label="URL 없음" onclick="document.getElementById('title').textContent='상호명을 검색해주세요.'; document.getElementById('store').hidden=false">URL 없음</button>
        <div id="store" hidden><input aria-label="매장명 검색"></div>`);
      await page.getByText('네이버 지도 링크를 입력해주세요.', { exact: true }).waitFor({ state: 'visible', timeout });
      assert.equal(await page.getByRole('textbox', { name: '매장명 검색', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'URL 없음', exact: true }).click();
      await page.getByRole('textbox', { name: '매장명 검색', exact: true }).waitFor({ state: 'visible', timeout });
      assert.equal(await page.getByText('상호명을 검색해주세요.', { exact: true }).count(), 1);
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
      for (const emptyCopy of ['아직 알림이 없어요.', '아직 알림이 없어요']) {
        await set(`<h1>알림</h1><button>새로고침</button><div>${emptyCopy}</div>`);
        assert.equal(await api.assertNotifications(page, timeout), 0);
      }
      await set('<h1>알림</h1><button>로그인</button>');
      await assert.rejects(api.assertNotifications(page, timeout), /비로그인/);
      await set('<h1>알림</h1><button>새로고침</button><div>알림을 불러오고 있어요.</div>');
      await assert.rejects(api.assertNotifications(page, timeout));
    });
    await t.test('MVP shows profile follow CTA while following feed and setting stay hidden', async () => {
      const card = '<button aria-label="김치찌개 상세 보기">카드</button>';
      await set(card);
      await api.assertFollowScopeHidden(page, timeout);
      await set(`<div hidden><button role="tab" aria-label="팔로잉 원픽 보기">팔로잉</button></div>${card}`);
      await api.assertFollowScopeHidden(page, timeout);
      for (const tab of ['팔로잉 원픽 보기', '전체 원픽 보기']) {
        await set(`<button role="tab" aria-label="${tab}">탭</button>${card}`);
        await assert.rejects(api.assertFollowScopeHidden(page, timeout), /숨겨야 할/);
      }
      await set('<div>로딩 중</div>');
      await assert.rejects(api.assertFollowScopeHidden(page, timeout));

      const share = '<button>프로필 공유하기</button>';
      for (const label of ['@someone 팔로우', '@someone 팔로우 취소']) {
        await set(`${share}<button aria-label="${label}">팔로우</button>`);
        await api.assertFollowCtaVisible(page, timeout);
      }
      await set(share);
      await assert.rejects(api.assertFollowCtaVisible(page, timeout));
      await set('<div>프로필</div>');
      await assert.rejects(api.assertFollowCtaVisible(page, timeout));

      const blocked = '<div>차단한 사용자</div>';
      await set(blocked);
      await api.assertFollowSettingHidden(page, timeout);
      await set(`${blocked}<div role="switch" aria-label="팔로우한 사람의 원픽 변경 알림" aria-checked="true">켜짐</div>`);
      await assert.rejects(api.assertFollowSettingHidden(page, timeout), /팔로우 알림/);
      await set(`${blocked}<div>팔로우한 사람의 원픽 변경</div>`);
      await assert.rejects(api.assertFollowSettingHidden(page, timeout), /팔로우 알림/);
      await set('<div>설정</div>');
      await assert.rejects(api.assertFollowSettingHidden(page, timeout));
    });
    await t.test('pick ids come from the current feed/detail RPCs, current reviews only', () => {
      const base = 'https://example.supabase.co/rest/v1';
      assert.deepEqual(api.pickIdsFromResponse(`${base}/rpc/home_pick_feed_page`, 'POST',
        [{ pick_id: 'p1', item_id: 'i1' }, { pick_id: null, item_id: 'i2' }, { item_id: 'i3' }]),
      [{ id: 'p1', itemId: 'i1' }]);
      assert.deepEqual(api.pickIdsFromResponse(`${base}/rpc/item_review_page`, 'POST', [
        { id: 'r1', item_id: 'i1', is_current: true, is_deleted: false },
        { id: 'r2', item_id: 'i1', is_current: false, is_deleted: false },
        { id: 'r3', item_id: 'i1', is_current: true, is_deleted: true },
        { id: 'r4', item_id: null, is_current: true },
      ]), [{ id: 'r1', itemId: 'i1' }, { id: 'r4', itemId: null }]);
      assert.deepEqual(api.pickIdsFromResponse(`${base}/picks?select=id&item_id=eq.i1`, 'GET', [{ id: 'l1', item_id: 'i1' }]),
        [{ id: 'l1', itemId: 'i1' }]);
      assert.deepEqual(api.pickIdsFromResponse(`${base}/rpc/home_pick_feed_page`, 'GET', [{ pick_id: 'p1' }]), []);
      assert.deepEqual(api.pickIdsFromResponse(`${base}/picks`, 'POST', [{ id: 'l1' }]), []);
      assert.deepEqual(api.pickIdsFromResponse(`${base}/rpc/search_items`, 'POST', [{ id: 'x', pick_id: 'y', is_current: true }]), []);
      assert.deepEqual(api.pickIdsFromResponse(`${base}/rpc/home_pick_feed_page`, 'POST', { message: 'error' }), []);
      assert.equal(api.pickIdSource(`${base}/rpc/item_review_page`, 'POST'), 'reviews');
      assert.equal(api.pickIdSource(`${base}/rpc/item_review_page_v2`, 'POST'), null);
    });
    await t.test('pick deep link stays on the review conversation screen', async () => {
      const at = async (path, html) => { await page.goto(`https://fixture.invalid${path}`); await page.setContent(html); };
      const header = '<button aria-label="이전 화면">‹</button><h1>한줄평 대화</h1>';
      await at('/pick/p1', `${header}<div>@someone</div><div>“국물이 진해요”</div>`);
      await api.assertPickConversation(page, 'p1', timeout);
      await at('/pick/p1', `${header}<div>삭제된 한줄평이에요. 기존 대화만 남아 있어요.</div>`);
      await api.assertPickConversation(page, 'p1', timeout);
      await at('/item/i1', `${header}<div>“국물이 진해요”</div>`);
      await assert.rejects(api.assertPickConversation(page, 'p1', timeout), /다른 화면/);
      for (const blocked of ['한줄평을 볼 수 없어요', '현재 공개 중인 원픽이 아니에요']) {
        await at('/pick/p1', `${header}<div>${blocked}</div>`);
        await assert.rejects(api.assertPickConversation(page, 'p1', timeout), /오류 화면/);
      }
      await at('/pick/p1', `${header}<div>한줄평 대화를 불러오고 있어요</div>`);
      await assert.rejects(api.assertPickConversation(page, 'p1', timeout));
      await at('/pick/p1', '<div>“국물이 진해요”</div>');
      await assert.rejects(api.assertPickConversation(page, 'p1', timeout));
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
