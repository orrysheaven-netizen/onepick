export const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', example: 'instagram.com/username' },
  { id: 'youtube', label: 'YouTube', example: 'youtube.com/@username' },
  { id: 'x', label: 'X', example: 'x.com/username' },
  { id: 'threads', label: 'Threads', example: 'threads.com/@username' },
  { id: 'naver_blog', label: '네이버 블로그', example: 'blog.naver.com/username' },
] as const;

export type SocialPlatform = typeof SOCIAL_PLATFORMS[number]['id'];
export type SocialLink = { platform: SocialPlatform; url: string };
export class SocialLinkValidationError extends Error {}

const hosts: Record<SocialPlatform, readonly string[]> = {
  instagram: ['instagram.com', 'www.instagram.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  threads: ['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'],
  naver_blog: ['blog.naver.com', 'm.blog.naver.com'],
};
const origins: Record<SocialPlatform, string> = {
  instagram: 'https://www.instagram.com', youtube: 'https://www.youtube.com',
  x: 'https://x.com', threads: 'https://www.threads.com', naver_blog: 'https://blog.naver.com',
};
const reserved = new Set(['accounts', 'explore', 'direct', 'stories', 'p', 'reel', 'reels',
  'about', 'legal', 'privacy', 'terms', 'home', 'search', 'i', 'settings', 'messages',
  'notifications', 'compose', 'intent', 'share', 'login', 'logout', 'signup', 'tos']);

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === 'string' && SOCIAL_PLATFORMS.some((item) => item.id === value);
}

/** Links only: never OAuth credentials, arbitrary schemes, or untrusted destinations. */
export function normalizeSocialLink(platform: SocialPlatform, raw: string): string {
  if (!isSocialPlatform(platform)) throw new SocialLinkValidationError('지원하지 않는 SNS예요.');
  const label = SOCIAL_PLATFORMS.find((item) => item.id === platform)!.label;
  const fail = (): never => { throw new SocialLinkValidationError(`${label} 사용자명 또는 프로필 주소를 확인해주세요.`); };
  const input = raw.trim();
  if (!input || input.length > 512 || /[\s\\\u0000-\u001f\u007f]/u.test(input)) return fail();
  let path: string;
  if (/[/:]/.test(input)) {
    if (input.startsWith('//')) return fail();
    let url: URL;
    try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`); }
    catch { return fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[platform].includes(url.hostname)) return fail();
    try { path = decodeURIComponent(url.pathname).replace(/\/$/, ''); }
    catch { return fail(); }
    // Reconstruct only the profile path: copied tracking queries/fragments are discarded.
  } else {
    path = '/' + input.replace(/^@/, '');
    if (platform === 'youtube' || platform === 'threads') path = '/@' + input.replace(/^@/, '');
  }
  let handle = path.slice(1);
  if (platform === 'youtube') {
    if (!/^\/@[A-Za-z0-9가-힣_.-]{3,30}$/.test(path) && !/^\/channel\/UC[A-Za-z0-9_-]{22}$/.test(path)) return fail();
  } else {
    if (platform === 'threads') {
      if (!handle.startsWith('@')) return fail();
      handle = handle.slice(1);
    }
    const pattern = platform === 'x' ? /^[A-Za-z0-9_]{1,15}$/
      : platform === 'naver_blog' ? /^[A-Za-z0-9_-]{2,30}$/ : /^[A-Za-z0-9._]{1,30}$/;
    if (!pattern.test(handle) || reserved.has(handle.toLowerCase()) || /^\.|\.$|\.\./.test(handle)) return fail();
    path = '/' + (platform === 'threads' ? '@' : '') + handle.toLowerCase();
  }
  return origins[platform] + path;
}

/** Validate again on reads before presenting any user-supplied URL as a link. */
export function parseSocialLink(row: { platform: unknown; url: unknown }): SocialLink | null {
  if (!isSocialPlatform(row.platform) || typeof row.url !== 'string') return null;
  try { return { platform: row.platform, url: normalizeSocialLink(row.platform, row.url) }; }
  catch { return null; }
}
