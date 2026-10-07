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

export async function assertOwnProfile(page, username, timeout = 15_000) {
  await page.getByRole('button', { name: '설정 열기', exact: true }).waitFor({ state: 'visible', timeout });
  await page.getByRole('button', { name: '내 댓글 보기', exact: true }).waitFor({ state: 'visible', timeout });
  await page.getByText(username, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

export async function assertPublicProfile(page, timeout = 15_000) {
  // Ignore controls on a still-mounted, hidden own-profile screen.
  await page.getByRole('button', { name: '음식 원픽 보기', exact: true })
    .filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
}

export async function checkMenuSelection(page, menuName, timeout = 15_000, allowAi = true) {
  await page.getByText(/^2 \/ 4 · /).waitFor({ state: 'visible', timeout });
  await page.getByRole('textbox', { name: '메뉴 이름', exact: true }).fill(menuName, { timeout });
  const escaped = menuName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Preserve the scheduled QA's AI suggestion path; safe mode only accepts exact matches.
  const chip = page.getByRole('button', { name: new RegExp(`^(?:.+ › )?${escaped}$${allowAi ? '|^AI 추천 ' : ''}`) });
  try {
    await chip.first().click({ timeout });
  } catch (error) {
    // Only missing choices can be explained by a blocked recommendation.
    // A disabled/covered chip or Next button must still fail in safety mode.
    if (await chip.count() === 0) error.code = 'QA_MENU_CHOICE_UNAVAILABLE';
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

export async function openOwnComments(page, timeout = 15_000) {
  await page.getByRole('button', { name: '내 댓글 보기', exact: true }).click({ timeout });
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

export async function assertFollowCtaVisible(page, timeout = 15_000) {
  await page.getByRole('button', { name: '프로필 공유하기' }).filter({ visible: true }).first()
    .waitFor({ state: 'visible', timeout });
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
