export const HIDDEN_BLOCK_USERNAME_SNAPSHOT = 'private-user';

export function blockedUserDisplayName(username: string) {
  return username === HIDDEN_BLOCK_USERNAME_SNAPSHOT ? '비공개 사용자' : `@${username}`;
}
