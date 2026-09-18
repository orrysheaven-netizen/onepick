export const MAX_PROFILE_BIO_LENGTH = 100;

export class ProfileBioValidationError extends Error {}

/** Count Unicode code points, so a single emoji is not counted as two UTF-16 units. */
export function profileBioLength(value: string): number {
  return Array.from(value.replace(/\r\n?/g, '\n')).length;
}

export function normalizeProfileBio(value: string): string | null {
  if (typeof value !== 'string') throw new ProfileBioValidationError('자기소개를 확인해주세요.');
  const bio = value.replace(/\r\n?/g, '\n').trim();
  if (profileBioLength(bio) > MAX_PROFILE_BIO_LENGTH) {
    throw new ProfileBioValidationError(`자기소개는 ${MAX_PROFILE_BIO_LENGTH}자 이내로 입력해주세요.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bio)) {
    throw new ProfileBioValidationError('사용할 수 없는 문자가 있어요. 내용을 확인해주세요.');
  }
  return bio || null;
}
