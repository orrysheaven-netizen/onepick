// UI contracts shared by the live QA and offline DOM fixtures. No network calls here.
export const SUGGESTION_ROUTE = '**/functions/v1/suggest-item-categories*';

export function ownProfileUsername(data, userId) {
  const rows = Array.isArray(data) ? data : [data];
  const own = rows.find((row) => row?.id === userId);
  if (typeof own?.username !== 'string' || !own.username.trim()) {
    throw new Error('QA 계정의 프로필 사용자명을 확인하지 못함');
  }
  return own.username;
}

// Own-profile layouts the live QA must support while #826 (#757 restructure) is in
// flight: `legacy` is main's profile (내 댓글 보기 on the profile, "공개 프로필 보기" text link,
// public share button "프로필 공유하기"); `757` is the restructured one (원픽 | 기록 tabs,
// 프로필 편집 / 내 프로필 공유하기 buttons, "공개 프로필 미리 보기", 내가 쓴 댓글 moved to
// 설정, public header share button "프로필 공유"). The layout is detected once from a
// control only one layout renders, and every later check asserts that layout's exact
// contract — no cross-layout selector unions.
export const PROFILE_LAYOUTS = Object.freeze(['legacy', '757']);
const PROFILE_TABS = Object.freeze(['원픽', '기록']);

function requireLayout(layout) {
  if (!PROFILE_LAYOUTS.includes(layout)) throw new Error(`알 수 없는 프로필 레이아웃: ${layout}`);
  return layout;
}

export async function detectOwnProfileLayout(page, timeout = 15_000) {
  await page.getByRole('button', { name: '설정 열기', exact: true }).waitFor({ state: 'visible', timeout });
  const tabs = page.getByRole('tab', { name: '원픽 탭', exact: true }).filter({ visible: true });
  const legacyComments = page.getByRole('button', { name: '내 댓글 보기', exact: true }).filter({ visible: true });
  await tabs.first().or(legacyComments.first()).first().waitFor({ state: 'visible', timeout });
  const [hasTabs, hasLegacy] = await Promise.all([tabs.count(), legacyComments.count()]);
  if (hasTabs && hasLegacy) throw new Error('프로필 화면에 신·구 레이아웃 요소가 함께 보임');
  return hasTabs ? '757' : 'legacy';
}

export async function assertOwnProfile(page, username, timeout = 15_000, layout = 'legacy') {
  await page.getByRole('button', { name: '설정 열기', exact: true }).waitFor({ state: 'visible', timeout });
  if (requireLayout(layout) === 'legacy') {
    await page.getByRole('button', { name: '내 댓글 보기', exact: true }).waitFor({ state: 'visible', timeout });
  } else {
    for (const label of PROFILE_TABS) {
      await page.getByRole('tab', { name: `${label} 탭`, exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
    }
    for (const name of ['프로필 편집', '내 프로필 공유하기', '다른 사람에게 보이는 내 프로필 미리 보기']) {
      await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
    }
    // #757 moved these off the profile; seeing them here means a half-applied layout.
    for (const name of ['내 댓글 보기', '공개 프로필 보기']) {
      if (await page.getByText(name, { exact: true }).filter({ visible: true }).count()) throw new Error(`#757 프로필에 구 진입 "${name}"이 남아 있음`);
    }
  }
  await page.getByText(username, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

export async function assertPublicProfile(page, timeout = 15_000, layout = 'legacy') {
  // Ignore controls on a still-mounted, hidden own-profile screen.
  await page.getByRole('button', { name: '음식 원픽 보기', exact: true })
    .filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
  if (requireLayout(layout) === '757') {
    // #757: share lives in the header as an icon button; the body share card is gone.
    await publicShareButton(page, layout).waitFor({ state: 'visible', timeout });
    if (await page.getByRole('button', { name: '프로필 공유하기', exact: true }).filter({ visible: true }).count()) {
      throw new Error('#757 공개 프로필에 본문 공유 카드 "프로필 공유하기"가 남아 있음');
    }
  }
}

export function publicShareButton(page, layout = 'legacy') {
  const name = requireLayout(layout) === '757' ? '프로필 공유' : '프로필 공유하기';
  return page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

// Own profile → public preview (/u/:username?returnTo=/profile).
export async function openPublicProfilePreview(page, timeout = 15_000, layout = 'legacy') {
  if (requireLayout(layout) === '757') {
    await page.getByRole('button', { name: '다른 사람에게 보이는 내 프로필 미리 보기', exact: true }).click({ timeout });
  } else {
    await page.getByText('공개 프로필 보기').first().click({ timeout });
  }
  await page.waitForURL(/\/u\//, { timeout });
}

// #757: the preview carries returnTo=/profile, so 뒤로 가기 lands on the own profile, not
// another /u/ screen or the home tab. Read-only.
export async function assertPreviewReturnsToOwnProfile(page, timeout = 15_000) {
  await page.getByRole('button', { name: '뒤로 가기', exact: true }).filter({ visible: true }).first().click({ timeout });
  await page.waitForURL((url) => /\/profile(?:[?#]|$)/.test(url.pathname + url.search) && !/\/u\//.test(url.pathname), { timeout });
  await page.getByRole('button', { name: '설정 열기', exact: true }).waitFor({ state: 'visible', timeout });
}

async function selectedTab(page, label, timeout) {
  const tab = page.getByRole('tab', { name: `${label} 탭`, exact: true }).filter({ visible: true }).first();
  await tab.waitFor({ state: 'visible', timeout });
  if ((await tab.getAttribute('aria-selected')) !== 'true') throw new Error(`"${label}" 탭이 선택 상태가 아님`);
  return tab;
}

// #757 원픽 | 기록: 기록 shows either rows (past Picks / pending or rejected requests) or
// its empty card; switching back restores 원픽. Returns what 기록 showed.
export async function assertProfileTabs(page, timeout = 15_000) {
  await selectedTab(page, '원픽', timeout);
  await page.getByRole('tab', { name: '기록 탭', exact: true }).filter({ visible: true }).first().click({ timeout });
  await selectedTab(page, '기록', timeout);
  const rows = page.getByRole('button', { name: / 원픽 상세 보기$/ }).filter({ visible: true });
  const requests = page.getByText(/^(검토 중|반려)$/).filter({ visible: true });
  const pastTitle = page.getByText('지난 원픽', { exact: true }).filter({ visible: true });
  const empty = page.getByText('아직 기록이 없어요.', { exact: true }).filter({ visible: true });
  const loading = page.getByLabel(/ 불러오는 중$/);
  await loading.first().waitFor({ state: 'hidden', timeout }).catch(() => {});
  await pastTitle.first().or(requests.first()).or(empty.first()).first().waitFor({ state: 'visible', timeout });
  const [rowCount, requestCount, isEmpty] = await Promise.all([rows.count(), requests.count(), empty.count()]);
  if (isEmpty && (rowCount || requestCount)) throw new Error('기록 탭이 빈 상태 문구와 기록 행을 함께 보임');
  await page.getByRole('tab', { name: '원픽 탭', exact: true }).filter({ visible: true }).first().click({ timeout });
  await selectedTab(page, '원픽', timeout);
  if (await empty.count()) throw new Error('원픽 탭으로 돌아왔는데 기록 빈 상태 문구가 남아 있음');
  return isEmpty ? { empty: true, rows: 0, requests: 0 } : { empty: false, rows: rowCount, requests: requestCount };
}

// #757: 프로필 편집 only hides the editor, so an unsaved bio draft survives close → reopen.
// Nothing is saved: the draft is typed, checked and then cancelled through the editor's
// own 취소, which resets it without a request.
export async function assertBioDraftPersists(page, draftText, timeout = 15_000) {
  const toggle = page.getByRole('button', { name: '프로필 편집', exact: true }).filter({ visible: true }).first();
  const input = page.getByRole('textbox', { name: '자기소개 입력', exact: true });
  await toggle.click({ timeout });
  const start = page.getByRole('button', { name: /^자기소개 (추가|수정)$/ }).filter({ visible: true }).first();
  await start.or(input).first().waitFor({ state: 'visible', timeout });
  if (await start.isVisible()) await start.click({ timeout });
  await input.waitFor({ state: 'visible', timeout });
  const original = await input.inputValue();
  await input.fill(draftText, { timeout });
  await toggle.click({ timeout });
  await input.waitFor({ state: 'hidden', timeout });
  await toggle.click({ timeout });
  await input.waitFor({ state: 'visible', timeout });
  const kept = await input.inputValue();
  if (kept !== draftText) throw new Error('프로필 편집을 닫고 다시 열자 소개 초안이 사라짐');
  const save = page.getByRole('button', { name: '자기소개 저장', exact: true });
  if ((await save.count()) && !(await save.isDisabled())) {
    // Never persist QA text: only trial-click to prove the control exists, then cancel.
    await save.click({ trial: true, timeout });
  }
  await page.getByRole('button', { name: '자기소개 편집 취소', exact: true }).click({ timeout });
  await input.waitFor({ state: 'hidden', timeout });
  await toggle.click({ timeout });
  return { original, kept };
}

// 390×844 (iPhone 13): the identity row, the two action buttons, the preview link and
// the tab row must sit inside the viewport width and must not overlap one another.
export async function assertProfileLayoutFits(page, viewport, timeout = 15_000) {
  const named = [
    ['설정 열기', 'button'], ['프로필 편집', 'button'], ['내 프로필 공유하기', 'button'],
    ['다른 사람에게 보이는 내 프로필 미리 보기', 'button'], ['원픽 탭', 'tab'], ['기록 탭', 'tab'],
  ];
  const boxes = [];
  for (const [name, role] of named) {
    const locator = page.getByRole(role, { name, exact: true }).filter({ visible: true }).first();
    await locator.waitFor({ state: 'visible', timeout });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`"${name}"의 위치를 읽지 못함`);
    boxes.push({ name, ...box });
  }
  const problems = [];
  for (const b of boxes) {
    if (b.x < 0 || b.x + b.width > viewport.width + 0.5) problems.push(`"${b.name}" 가로 경계 이탈 (x ${Math.round(b.x)}, w ${Math.round(b.width)})`);
    if (b.width < 1 || b.height < 1) problems.push(`"${b.name}" 크기 0`);
  }
  const overlaps = (a, b) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  const pairs = [['프로필 편집', '내 프로필 공유하기'], ['원픽 탭', '기록 탭'], ['내 프로필 공유하기', '다른 사람에게 보이는 내 프로필 미리 보기']];
  for (const [l, r] of pairs) {
    const a = boxes.find((b) => b.name === l), c = boxes.find((b) => b.name === r);
    if (overlaps(a, c)) problems.push(`"${l}"와 "${r}" 겹침`);
  }
  if (problems.length) throw new Error(problems.join(' · '));
  return boxes.map(({ name, x, y, width, height }) => ({ name, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }));
}

export async function checkMenuSelection(page, menuName, timeout = 15_000) {
  await page.getByText(/^2 \/ 4 · /).waitFor({ state: 'visible', timeout });
  await page.getByRole('textbox', { name: '메뉴 이름', exact: true }).fill(menuName, { timeout });
  const classified = page.getByText('메뉴를 확인했어요. 다음으로 넘어가주세요.', { exact: true });
  try {
    await classified.waitFor({ state: 'visible', timeout });
  } catch (error) {
    // A blocked recommendation can leave classification unavailable. The caller
    // must also observe an actually blocked request before downgrading to a warning.
    if (!(await classified.isVisible())) error.code = 'QA_MENU_CLASSIFICATION_UNAVAILABLE';
    throw error;
  }
  // confirmMenu may write: only trial-click the real, enabled Next button.
  await page.getByRole('button', { name: '다음', exact: true }).click({ trial: true, timeout });
}

function homeSearchDialog(page) {
  return page.getByRole('heading', { name: '어떤 메뉴를 찾으세요?', exact: true }).locator('..');
}

export async function openHomeSearch(page, timeout = 15_000) {
  await page.getByRole('button', { name: '메뉴 검색', exact: true }).click({ timeout });
  const dialog = homeSearchDialog(page);
  await dialog.getByRole('textbox', { name: '메뉴명', exact: true }).waitFor({ state: 'visible', timeout });
  return dialog;
}

export async function submitHomeSearch(page, searchText, timeout = 15_000) {
  const dialog = homeSearchDialog(page);
  await dialog.getByRole('textbox', { name: '메뉴명', exact: true }).fill(searchText, { timeout });
  await dialog.getByRole('button', { name: '검색하기', exact: true }).click({ timeout });
  const results = dialog.getByRole('button', { name: / 상세 보기$/ });
  await results.first().waitFor({ state: 'visible', timeout });
  return results;
}

export async function assertNotifications(page, timeout = 15_000) {
  await page.getByRole('heading', { name: '알림', exact: true }).waitFor({ state: 'visible', timeout });
  const rows = page.getByRole('button', { name: /^(새|읽은) 알림, / });
  const empty = page.getByText(/^아직 알림이 없어요[.!?…]?$/);
  const login = page.getByRole('button', { name: '로그인', exact: true });
  await rows.first().or(empty).or(login).first().waitFor({ state: 'visible', timeout });
  if (await login.isVisible()) throw new Error('알림 화면이 비로그인 상태로 보임');
  await page.getByRole('button', { name: '새로고침', exact: true }).click({ trial: true, timeout });
  return rows.count();
}

export async function openOwnComments(page, timeout = 15_000, layout = 'legacy') {
  if (requireLayout(layout) === '757') {
    // #757: 내가 쓴 댓글 is a 설정 entry, not a profile button.
    await page.getByRole('button', { name: '설정 열기', exact: true }).click({ timeout });
    await page.waitForURL(/\/settings(?:[?#]|$)/, { timeout });
    await page.getByRole('link', { name: '내가 쓴 댓글', exact: true }).filter({ visible: true }).first().click({ timeout });
  } else {
    await page.getByRole('button', { name: '내 댓글 보기', exact: true }).click({ timeout });
  }
  await page.waitForURL(/\/comments(?:[?#]|$)/, { timeout });
}

export async function openNotificationsTab(page, timeout = 15_000) {
  await page.getByRole('tab', { name: '알림', exact: true })
    .or(page.getByRole('link', { name: '알림', exact: true })).first().click({ timeout });
  await page.waitForURL(/\/notifications(?:[?#]|$)/, { timeout });
}

// MVP follow exposure is split: the public-profile CTA is visible, while the
// following-feed scope and follow-change notification setting remain hidden.
// Each check first waits for a control that proves the screen rendered.
async function assertAbsent(locator, what) {
  const shown = await locator.filter({ visible: true }).count();
  if (shown) throw new Error(`초기 MVP에서 숨겨야 할 ${what}이(가) ${shown}개 보임`);
}

export async function assertFollowScopeHidden(page, timeout = 15_000) {
  await page.getByRole('button', { name: / 상세 보기$/ }).filter({ visible: true }).first()
    .waitFor({ state: 'visible', timeout });
  await assertAbsent(page.getByRole('tab', { name: '팔로잉 원픽 보기' }), '팔로잉 피드 탭');
  await assertAbsent(page.getByRole('tab', { name: '전체 원픽 보기' }), '팔로잉/전체 전환 탭');
}

export async function assertFollowCtaVisible(page, timeout = 15_000, layout = 'legacy') {
  await publicShareButton(page, layout).waitFor({ state: 'visible', timeout });
  await page.getByRole('button', { name: /^@.+ 팔로우( 취소)?$/ }).filter({ visible: true }).first()
    .waitFor({ state: 'visible', timeout });
}

export async function assertFollowSettingHidden(page, timeout = 15_000) {
  await page.getByText('차단한 사용자', { exact: true }).filter({ visible: true }).first()
    .waitFor({ state: 'visible', timeout });
  await assertAbsent(page.getByRole('switch', { name: '팔로우한 사람의 원픽 변경 알림' }), '팔로우 알림 설정');
  await assertAbsent(page.getByText('팔로우한 사람의 원픽 변경', { exact: true }), '팔로우 알림 설정');
}

// Pick ids the feed and item detail load, from the app's current read paths:
// home_pick_feed_page (pick_id) and item_review_page (id, current reviews only).
// The legacy GET /rest/v1/picks rows are still accepted.
export function pickIdSource(url, method) {
  const { pathname } = new URL(url);
  if (method === 'POST' && pathname.endsWith('/rest/v1/rpc/home_pick_feed_page')) return 'feed';
  if (method === 'POST' && pathname.endsWith('/rest/v1/rpc/item_review_page')) return 'reviews';
  if (method === 'GET' && pathname.endsWith('/rest/v1/picks')) return 'picks';
  return null;
}

export function pickIdsFromResponse(url, method, body) {
  const rows = Array.isArray(body) ? body : [];
  const text = (value) => (typeof value === 'string' && value ? value : null);
  switch (pickIdSource(url, method)) {
    case 'feed':
      return rows.filter((row) => text(row?.pick_id)).map((row) => ({ id: row.pick_id, itemId: text(row.item_id) }));
    case 'reviews':
      return rows.filter((row) => text(row?.id) && row.is_current === true && row.is_deleted !== true)
        .map((row) => ({ id: row.id, itemId: text(row.item_id) }));
    case 'picks':
      return rows.filter((row) => text(row?.id)).map((row) => ({ id: row.id, itemId: text(row.item_id) }));
    default:
      return [];
  }
}

// /pick/:id is the standalone review conversation screen (#526): it stays on /pick/:id,
// shows the focused one-line review and has no share button of its own.
export async function assertPickConversation(page, pickId, timeout = 15_000) {
  const { pathname } = new URL(page.url());
  if (pathname !== `/pick/${encodeURIComponent(pickId)}`) throw new Error(`원픽 딥링크가 다른 화면으로 이동: ${pathname}`);
  await page.getByText('한줄평 대화를 불러오고 있어요', { exact: true }).waitFor({ state: 'hidden', timeout });
  for (const blocked of ['한줄평을 볼 수 없어요', '현재 공개 중인 원픽이 아니에요']) {
    if (await page.getByText(blocked, { exact: true }).filter({ visible: true }).count()) throw new Error(`원픽 딥링크 오류 화면: ${blocked}`);
  }
  await page.getByRole('button', { name: '이전 화면', exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
  await page.getByText(/^“.*”$|^삭제된 한줄평이에요/).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

