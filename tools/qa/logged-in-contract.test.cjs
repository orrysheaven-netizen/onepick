const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// Reduced accessible DOM from main's profile, registration and notification screens.
// No server, credentials or app/AI endpoint is contacted; all URLs are intercepted.
test('logged-in QA contracts against isolated UI states', async (t) => {
  const api = await import('./logged-in-contract.mjs');
  const browser = await chromium.launch(process.env.QA_CHROMIUM_PATH
    ? { executablePath: process.env.QA_CHROMIUM_PATH } : {});
  const context = await browser.newContext(api.qaContextOptions({}));
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
    await t.test('regular QA retains SW policy and explicit interception blocks only the isolated context', () => {
      assert.equal(api.qaContextOptions({}).serviceWorkers, 'allow');
      assert.equal(api.qaContextOptions({}).locale, 'ko-KR');
      assert.equal(api.qaContextOptions({ viewport: { width: 390 } }, true).serviceWorkers, 'block');
    });
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
    await t.test('home profile labels use nickname without a forced @ prefix', async () => {
      await set('<button aria-label="오리 프로필 보기">오리</button>');
      assert.equal(await page.getByRole('button', { name: /.+ 프로필 보기$/ }).count(), 1);
      assert.equal(await page.getByRole('button', { name: /^@.+ 프로필 보기$/ }).count(), 0);
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
    const successCopy = '메뉴를 확인했어요. 다음으로 넘어가주세요.';
    const menu = (copy, disabled = false) => `<div>2 / 4 · 매장</div><input aria-label="메뉴 이름"><div id="classification">${copy}</div><button ${disabled ? 'disabled' : ''} onclick="window.submitted=true">다음</button>`;
    await t.test('automatic menu classification needs no category click and never submits', async () => {
      for (const name of ['도가니탕', '메뉴(특)+']) {
        await set(menu(successCopy));
        await api.checkMenuSelection(page, name, timeout);
        assert.equal(await page.getByRole('textbox', { name: '메뉴 이름' }).inputValue(), name);
        assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
      }
      await set(menu('분류 중', true));
      await page.locator('input').evaluate((input, copy) => {
        input.addEventListener('input', () => setTimeout(() => {
          document.getElementById('classification').textContent = copy;
          document.querySelector('button').disabled = false;
        }, 60), { once: true });
      }, successCopy);
      await api.checkMenuSelection(page, '도가니탕', timeout);
      assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
    });
    await t.test('empty AI recommendation is mocked only in a short-lived SW-blocked context', async () => {
      const name = 'QA미분류검증메뉴20261010';
      const isolated = await browser.newContext(api.qaContextOptions({}, true));
      let calls = 0;
      let unexpectedIsolatedRequests = 0;
      await isolated.route('**/*', async (route) => {
        if (new URL(route.request().url()).hostname === 'fixture.invalid') {
          await route.fulfill({ contentType: 'text/html', body: '<body></body>' });
        } else {
          unexpectedIsolatedRequests += 1;
          await route.abort();
        }
      });
      await isolated.route(api.SUGGESTION_ROUTE, async (route) => {
        calls += 1;
        const req = route.request().postDataJSON();
        assert.equal(req.store.menuName, name);
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ suggestions: [], needsNewCategory: true }),
        });
      });
      const mockPage = await isolated.newPage();
      try {
        await mockPage.goto('https://fixture.invalid/profile');
        await mockPage.setContent(menu('추천 중', true));
        const input = mockPage.getByRole('textbox', { name: '메뉴 이름', exact: true });
        await input.evaluate((element) => {
          element.addEventListener('input', async () => {
            const response = await fetch('/functions/v1/suggest-item-categories', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ store: { menuName: element.value } }),
            });
            const result = await response.json();
            if (result.needsNewCategory && result.suggestions.length === 0) {
              document.querySelector('button').disabled = false;
              document.getElementById('classification').textContent = '메뉴를 확인했어요. 다음으로 넘어가주세요.';
            }
          }, { once: true });
        });
        await input.fill(name);
        await mockPage.getByText(successCopy, { exact: true }).waitFor({ state: 'visible', timeout });
        await api.checkUnclassifiedMenuNext(mockPage, name, timeout);
        assert.equal(calls, 1, 'empty AI response must actually be intercepted');
        assert.equal(await input.inputValue(), name);
        assert.equal(await mockPage.evaluate(() => Boolean(window.submitted)), false, 'trial click cannot submit');
      } finally {
        await isolated.close();
      }
      assert.equal(unexpectedIsolatedRequests, 0);
      // A synthetic menu must not alter the ordinary QA page or its routing.
      assert.equal(await page.evaluate(() => window.location.pathname), '/profile');
      await set(menu(successCopy, true));
      await page.getByRole('textbox', { name: '메뉴 이름' }).fill(name);
      await assert.rejects(api.checkUnclassifiedMenuNext(page, name, timeout), 'disabled Next cannot pass');
      await set(menu(successCopy));
      await page.getByRole('textbox', { name: '메뉴 이름' }).fill('다른 메뉴');
      await assert.rejects(api.checkUnclassifiedMenuNext(page, name, timeout), /유지되지/);
      assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
    });
    await t.test('missing, loading, unresolved and legacy category choices cannot pass', async () => {
      for (const copy of ['', '분류 중', '메뉴를 분류하지 못했어요.', '<button>도가니탕</button>', '<button>AI 추천 도가니탕</button>']) {
        await set(menu(copy));
        await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout),
          (error) => error.code === 'QA_MENU_CLASSIFICATION_UNAVAILABLE');
        assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
      }
    });
    await t.test('disabled or covered Next remains a failure even when classification succeeds', async () => {
      await set(menu(successCopy, true));
      await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout),
        (error) => error.code !== 'QA_MENU_CLASSIFICATION_UNAVAILABLE');
      await set(menu(successCopy));
      await page.locator('button').evaluate((button) => {
        const cover = document.createElement('div');
        cover.style.cssText = 'position:absolute;inset:0;z-index:10';
        button.style.cssText = 'position:relative';
        button.parentNode.insertBefore(cover, button);
        const rect = button.getBoundingClientRect();
        cover.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;z-index:10`;
      });
      await assert.rejects(api.checkMenuSelection(page, '도가니탕', timeout),
        (error) => error.code !== 'QA_MENU_CLASSIFICATION_UNAVAILABLE');
      assert.equal(await page.evaluate(() => Boolean(window.submitted)), false);
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
    // #757 (#826) own-profile layout: tabs, 프로필 편집 toggle that only hides the editor,
    // "공개 프로필 미리 보기" with returnTo=/profile, 내가 쓴 댓글 under 설정, header share "프로필 공유".
    const profile757 = ({ withLegacy = '', tabs = true, records = '<div>아직 기록이 없어요.</div>', bio = '' } = {}) => `
      <div>qa_user</div>
      <button aria-label="설정 열기" onclick="history.pushState({}, '', '/settings'); document.getElementById('settings').hidden=false">설정</button>
      <button aria-label="음식 원픽 보기">음식</button>
      <div style="display:flex;gap:8px;width:358px">
        <button id="edit" style="flex:1;height:36px" aria-label="프로필 편집" onclick="const e=document.getElementById('editor'); if(!window.opened){window.opened=true;e.hidden=false;} else {e.hidden=!e.hidden;}">프로필 편집</button>
        <button style="flex:1;height:36px" aria-label="내 프로필 공유하기">프로필 공유</button>
      </div>
      <div id="editor" hidden>
        <button id="start" aria-label="자기소개 ${bio ? '수정' : '추가'}" onclick="document.getElementById('bio').hidden=false; this.hidden=true; document.getElementById('bio-input').value='${bio}'">${bio ? '수정' : '추가'}</button>
        <div id="bio" hidden>
          <textarea id="bio-input" aria-label="자기소개 입력"></textarea>
          <button aria-label="자기소개 저장" onclick="window.saved=true">저장하기</button>
          <button aria-label="자기소개 편집 취소" onclick="document.getElementById('bio').hidden=true; document.getElementById('start').hidden=false; document.getElementById('bio-input').value=''">닫기</button>
        </div>
      </div>
      <button style="display:block;height:32px;width:200px" aria-label="다른 사람에게 보이는 내 프로필 미리 보기" onclick="history.pushState({}, '', '/u/qa_user?returnTo=%2Fprofile'); document.getElementById('public').hidden=false">공개 프로필 미리 보기</button>
      ${tabs ? `<div role="tablist" style="display:flex;width:358px">
        <button role="tab" style="flex:1;height:48px" aria-label="원픽 탭" aria-selected="true" onclick="window.pick()">원픽</button>
        <button role="tab" style="flex:1;height:48px" aria-label="기록 탭" aria-selected="false" onclick="window.rec()">기록</button>
      </div>` : ''}
      <div id="picks"><button aria-label="김치찌개 원픽 상세 보기">행</button></div>
      <div id="records" hidden>${records}</div>
      ${withLegacy}
      <div id="settings" hidden><div>차단한 사용자</div><a role="link" href="#" onclick="event.preventDefault(); history.pushState({}, '', '/comments')">내가 쓴 댓글</a></div>
      <div id="public" hidden>
        <button aria-label="뒤로 가기" onclick="history.pushState({}, '', '/profile'); this.parentElement.hidden=true">‹</button>
        <button aria-label="프로필 공유">공유</button>
        <button aria-label="음식 원픽 보기">음식</button>
        <button aria-label="@qa_user 팔로우">팔로우</button>
      </div>
      <script>
        const tabsEl = document.querySelectorAll('[role=tab]');
        window.pick = () => { tabsEl[0].setAttribute('aria-selected','true'); tabsEl[1].setAttribute('aria-selected','false'); document.getElementById('picks').hidden=false; document.getElementById('records').hidden=true; };
        window.rec = () => { tabsEl[0].setAttribute('aria-selected','false'); tabsEl[1].setAttribute('aria-selected','true'); document.getElementById('picks').hidden=true; document.getElementById('records').hidden=false; };
      </script>`;
    await t.test('#757 profile layout is detected from its own controls and never mixed with legacy', async () => {
      await set(profile757());
      assert.equal(await api.detectOwnProfileLayout(page, timeout), '757');
      await api.assertOwnProfile(page, 'qa_user', timeout, '757');
      await assert.rejects(api.assertOwnProfile(page, 'qa_user', timeout, 'legacy'), 'legacy contract must not pass on the #757 layout');
      await set('<div>qa_user</div><button>설정 열기</button><button>내 댓글 보기</button><button aria-label="음식 원픽 보기">음식</button>');
      assert.equal(await api.detectOwnProfileLayout(page, timeout), 'legacy');
      await assert.rejects(api.assertOwnProfile(page, 'qa_user', timeout, '757'), '#757 contract must not pass on the legacy layout');
      await set(profile757({ withLegacy: '<button>내 댓글 보기</button>' }));
      await assert.rejects(api.detectOwnProfileLayout(page, timeout), /함께 보임/);
      await set(profile757({ withLegacy: '<div>공개 프로필 보기</div>' }));
      await assert.rejects(api.assertOwnProfile(page, 'qa_user', timeout, '757'), /구 진입/);
      await set(profile757({ tabs: false }));
      await assert.rejects(api.assertOwnProfile(page, 'qa_user', timeout, '757'));
      await set('<button>설정 열기</button><div>로딩 중</div>');
      await assert.rejects(api.detectOwnProfileLayout(page, timeout));
      await assert.rejects(api.assertOwnProfile(page, 'qa_user', timeout, 'nope'), /알 수 없는/);
    });
    await t.test('#757 원픽 | 기록 tabs switch, show records or the empty card, and return to 원픽', async () => {
      await set(profile757());
      assert.deepEqual(await api.assertProfileTabs(page, timeout), { empty: true, rows: 0, requests: 0 });
      assert.equal(await page.getByRole('tab', { name: '원픽 탭' }).getAttribute('aria-selected'), 'true');
      await set(profile757({ records: '<div>지난 원픽</div><button aria-label="라멘 원픽 상세 보기">행</button><div>검토 중</div><div>반려</div>' }));
      assert.deepEqual(await api.assertProfileTabs(page, timeout), { empty: false, rows: 1, requests: 2 });
      await set(profile757({ records: '<div>아직 기록이 없어요.</div><div>지난 원픽</div><button aria-label="라멘 원픽 상세 보기">행</button>' }));
      await assert.rejects(api.assertProfileTabs(page, timeout), /함께 보임/);
      await set(profile757({ records: '<div>불러오는 중</div>' }));
      await assert.rejects(api.assertProfileTabs(page, timeout));
      // A tab that does not take the selected state is a failure, not a pass.
      await set(profile757().replace('onclick="window.rec()"', ''));
      await assert.rejects(api.assertProfileTabs(page, timeout), /선택 상태가 아님/);
    });
    await t.test('#757 bio draft survives 프로필 편집 close → reopen and is never saved', async () => {
      await set(profile757());
      const result = await api.assertBioDraftPersists(page, 'QA 초안', timeout);
      assert.deepEqual(result, { original: '', kept: 'QA 초안' });
      assert.equal(await page.evaluate(() => Boolean(window.saved)), false, 'save is only trial-clicked');
      assert.equal(await page.getByRole('textbox', { name: '자기소개 입력' }).isVisible(), false, 'editor is closed again afterwards');
      await set(profile757({ bio: '기존 소개' }));
      assert.deepEqual(await api.assertBioDraftPersists(page, 'QA 초안', timeout), { original: '기존 소개', kept: 'QA 초안' });
      // An editor that unmounts on close (losing the draft) is the regression this guards.
      await set(profile757().replace("e.hidden=!e.hidden;", "e.hidden=!e.hidden; if(e.hidden){document.getElementById('bio-input').value='';}"));
      await assert.rejects(api.assertBioDraftPersists(page, 'QA 초안', timeout), /초안이 사라짐/);
    });
    await t.test('#757 preview opens /u/ with returnTo and 뒤로 가기 lands on the own profile', async () => {
      await set(profile757());
      await api.openPublicProfilePreview(page, timeout, '757');
      assert.match(new URL(page.url()).pathname + new URL(page.url()).search, /^\/u\/qa_user\?returnTo=%2Fprofile$/);
      await api.assertPublicProfile(page, timeout, '757');
      await api.assertFollowCtaVisible(page, timeout, '757');
      await api.assertPreviewReturnsToOwnProfile(page, timeout);
      assert.equal(new URL(page.url()).pathname, '/profile');
      // Legacy share card on the #757 public profile, or the legacy text link on the #757 own profile, fail.
      await set(profile757().replace('aria-label="프로필 공유">공유', 'aria-label="프로필 공유하기">공유'));
      await api.openPublicProfilePreview(page, timeout, '757');
      await assert.rejects(api.assertPublicProfile(page, timeout, '757'));
      await assert.rejects(api.assertFollowCtaVisible(page, timeout, '757'));
      await set(profile757());
      await assert.rejects(api.openPublicProfilePreview(page, timeout, 'legacy'));
      // Back that goes somewhere else than /profile fails.
      await set(profile757().replace("history.pushState({}, '', '/profile')", "history.pushState({}, '', '/')"));
      await api.openPublicProfilePreview(page, timeout, '757');
      await assert.rejects(api.assertPreviewReturnsToOwnProfile(page, timeout));
    });
    await t.test('#757 own comments are reached through 설정, legacy through the profile button', async () => {
      await set(profile757());
      await api.openOwnComments(page, timeout, '757');
      assert.equal(new URL(page.url()).pathname, '/comments');
      await set(profile757().replace('내가 쓴 댓글</a>', '내 댓글</a>'));
      await assert.rejects(api.openOwnComments(page, timeout, '757'));
      await set(profile757());
      await assert.rejects(api.openOwnComments(page, timeout, 'legacy'), 'legacy path must not find a button the #757 layout no longer has');
    });
    await t.test('#757 layout fits 390×844 and flags overlap or overflow', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await set(profile757());
      const boxes = await api.assertProfileLayoutFits(page, { width: 390, height: 844 }, timeout);
      assert.equal(boxes.length, 6);
      await set(profile757().replace('style="flex:1;height:36px" aria-label="내 프로필 공유하기"', 'style="position:absolute;left:0;top:0;width:500px;height:36px" aria-label="내 프로필 공유하기"'));
      await assert.rejects(api.assertProfileLayoutFits(page, { width: 390, height: 844 }, timeout), /가로 경계 이탈/);
      await set(profile757().replace('<div style="display:flex;gap:8px;width:358px">', '<div style="position:relative;width:358px;height:36px">').replace('id="edit" style="flex:1;height:36px"', 'id="edit" style="position:absolute;left:0;width:200px;height:36px"').replace('style="flex:1;height:36px" aria-label="내 프로필 공유하기"', 'style="position:absolute;left:100px;width:200px;height:36px" aria-label="내 프로필 공유하기"'));
      await assert.rejects(api.assertProfileLayoutFits(page, { width: 390, height: 844 }, timeout), /겹침/);
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

