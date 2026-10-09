export const MAX_PROFILE_NICKNAME_LENGTH = 15;
export const UNSET_PROFILE_DISPLAY_NAME = '원픽 사용자';

export class ProfileNicknameValidationError extends Error {}

/** PostgreSQL char_length counts Unicode code points, not UTF-16 units or grapheme clusters. */
export function profileNicknameLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeProfileNickname(input: string): string | null {
  if (typeof input !== 'string') throw new ProfileNicknameValidationError('닉네임을 확인해주세요.');
  const nickname = input.trim();
  if (profileNicknameLength(nickname) > MAX_PROFILE_NICKNAME_LENGTH) {
    throw new ProfileNicknameValidationError('닉네임은 15자 이내로 입력해주세요.');
  }
  return nickname || null;
}

/** Presentation only: never use a nickname for user IDs, search cursors or profile URLs. */
export function profileDisplayName(nickname: string | null | undefined): string {
  return nickname?.trim() || UNSET_PROFILE_DISPLAY_NAME;
}

export function nicknameQuestionPreview(nickname: string | null | undefined): string {
  const name = nickname?.trim();
  return name ? `${name}님의 곱창 원픽은?` : '원픽 사용자의 곱창 원픽은?';
}
