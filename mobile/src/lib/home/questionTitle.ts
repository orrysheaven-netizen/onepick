// Casual title shown above the Home daily question ("당신의 {메뉴} 원픽은?").
// The 10 templates rotate by Korean date, so everyone sees the same title on the same day
// and it changes together with the daily menu. `{menu}` is replaced by the menu name.
export const HOME_QUESTION_TITLE_TEMPLATES = [
  '{menu} 고수님들 모십니다',
  '인생 {menu}집 하나만 알려줘요',
  '{menu} 맛집 영업 환영 🔥',
  '여기 {menu} 좀 아는 사람?',
  '{menu} 원픽, 살짝 공유해줄래요?',
  '나만 알기 아까운 {menu}집 있죠?',
  '{menu} 먹으러 어디 가요?',
  '{menu} 원픽 자리 비어 있어요 🙋',
  '숨은 {menu} 맛집 제보 받아요',
  '단골 {menu}집 털어주세요',
] as const;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since 1970-01-01 in Korea time (UTC+9, no daylight saving). */
export function koreanDayNumber(now: Date): number {
  return Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS);
}

export function homeQuestionTitle(menuName: string, now: Date = new Date()): string {
  const templates = HOME_QUESTION_TITLE_TEMPLATES;
  const day = koreanDayNumber(now);
  const index = ((day % templates.length) + templates.length) % templates.length;
  return templates[index].replace('{menu}', menuName);
}
