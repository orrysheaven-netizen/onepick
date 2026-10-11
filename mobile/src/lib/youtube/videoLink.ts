export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
const SHORT_VIDEO_HOSTS = ['youtu.be', 'www.youtu.be'];

/**
 * Video ID from a shared YouTube video link (watch, youtu.be, Shorts, live, embed).
 * Channel, playlist-only and non-YouTube links return null. Keep in sync with
 * parseYouTubeVideoUrl in supabase/functions/youtube-catalog/youtubeCatalog.ts,
 * which re-checks every link on the server.
 */
export function parseYouTubeVideoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (SHORT_VIDEO_HOSTS.includes(host)) {
    return parts.length === 1 && YOUTUBE_VIDEO_ID_PATTERN.test(parts[0]) ? parts[0] : null;
  }
  if (!VIDEO_HOSTS.includes(host)) return null;
  if (parts.length === 1 && parts[0] === 'watch') {
    const id = url.searchParams.get('v') ?? '';
    return YOUTUBE_VIDEO_ID_PATTERN.test(id) ? id : null;
  }
  if (parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0]) && YOUTUBE_VIDEO_ID_PATTERN.test(parts[1])) return parts[1];
  return null;
}

export function youtubeVideoUrl(id: string): `https://www.youtube.com/watch?v=${string}` {
  return `https://www.youtube.com/watch?v=${id}`;
}
