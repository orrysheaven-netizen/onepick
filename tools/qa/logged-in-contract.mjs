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

export async function assertNotifications(page, timeout = 15_000) {
  await page.getByRole('heading', { name: '알림', exact: true }).waitFor({ state: 'visible', timeout });
  const rows = page.getByRole('button', { name: /^(새|읽은) 알림, / });
  const empty = page.getByText('아직 알림이 없어요', { exact: true });
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
