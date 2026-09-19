import { AppError } from '@/errors/appError';

/** A comment's delivery style, not the account owner's personality type. */
export type ProfileAiTone = 'direct' | 'warm';
export const PROFILE_AI_TONES = [
  { value: 'direct', title: '나 T야. 근거부터 줘.', label: '담백한 해석', description: '선택한 이유를 또렷하게.' },
  { value: 'warm', title: '난 에뿌야. 살살해줭.', label: '다정한 해석', description: '취향의 연결을 부드럽게.' },
] as const;

export function requireProfileAiTone(value: unknown): ProfileAiTone {
  if (value !== 'direct' && value !== 'warm') throw new AppError('AI_REVIEW_FAILED');
  return value;
}

export function profileAiToneLabel(value: ProfileAiTone | null | undefined): string {
  return value === 'direct' ? '담백한 해석' : value === 'warm' ? '다정한 해석' : '취향 해석';
}
