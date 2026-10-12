// Approved Home card copy, 2026-10-08: a fixed title and one personalized question.
// The DB still chooses the menu each day; the heading no longer rotates.
export function homeQuestionTitle(): string {
  return '오늘의 원픽';
}

export function homeQuestionSubtitle(menuName: string, nickname?: string | null): string {
  const name = nickname?.trim();
  return `${name ? `${name}님, ` : ''}${menuName} 먹으러 어디 가요?`;
}
