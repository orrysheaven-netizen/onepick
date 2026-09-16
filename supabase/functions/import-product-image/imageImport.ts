// Exact manufacturer hosts only. Do not widen this to arbitrary user supplied hosts.
// Technical support for a source does not grant permission to reuse its images.
export const ALLOWED_HOSTS = new Set([
  'nongshim.com', 'www.nongshim.com', 'brand.nongshim.com', 'image.nongshim.com',
  'otoki.com', 'www.otoki.com', 'hitejinro.com', 'www.hitejinro.com',
  'ob.co.kr', 'www.ob.co.kr', 'orionworld.com', 'www.orionworld.com',
  'lottewellfood.com', 'www.lottewellfood.com', 'cdn.lottewellfood.com',
]);
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_HTML = 512 * 1024;

export function validateSource(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('IMAGE_SOURCE_UNSUPPORTED'); }
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password ||
    (url.port && url.port !== '443') || !ALLOWED_HOSTS.has(url.hostname)) throw new Error('IMAGE_SOURCE_UNSUPPORTED');
  url.hash = '';
  return url;
}

export async function readLimited(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) throw new Error('IMAGE_IMPORT_FAILED');
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('PHOTO_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

async function download(url: URL, fetcher: typeof fetch) {
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url.href, {
      redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { Accept: 'text/html,image/jpeg,image/png', 'User-Agent': 'OnePick-ImagePreview/1.0' },
    });
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('IMAGE_IMPORT_FAILED');
      url = validateSource(new URL(location, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('IMAGE_IMPORT_FAILED'); }
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['text/html','image/jpeg','image/png'].includes(type ?? '')) {
      await response.body?.cancel(); throw new Error('PHOTO_INVALID');
    }
    const limit = type === 'text/html' ? MAX_HTML : MAX_IMAGE;
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > limit) { await response.body?.cancel(); throw new Error('PHOTO_TOO_LARGE'); }
    return { bytes: await readLimited(response.body, limit), type, url };
  }
  throw new Error('IMAGE_IMPORT_FAILED');
}

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const key = entity.slice(1,-1).toLowerCase();
    const named: Record<string,string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (named[key]) return named[key];
    const number = key.startsWith('#x') ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}

export function extractImageUrl(html: string, base: URL) {
  const candidates: { value: string; rank: number }[] = [];
  for (const tag of html.match(/<(?:meta|img)\b[^>]{0,8192}>/gi) ?? []) {
    const attrs: Record<string,string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
    }
    const property = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (attrs.content && ['og:image:secure_url','og:image','twitter:image'].includes(property)) candidates.push({ value: attrs.content, rank: property === 'og:image:secure_url' ? 0 : 1 });
    if (/^<img/i.test(tag) && attrs.src && attrs.alt && !/logo|icon|로고/i.test(attrs.alt)) candidates.push({ value: attrs.src, rank: 2 });
  }
  for (const { value } of candidates.sort((a,b) => a.rank-b.rank)) {
    try { return validateSource(new URL(value,base).href); } catch { /* Skip unsupported image hosts; never fetch them. */ }
  }
  throw new Error('IMAGE_IMPORT_FAILED');
}

export function imageType(bytes: Uint8Array) {
  let width = 0, height = 0, type = '';
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value,i) => bytes[i] === value)) {
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    width = view.getUint32(16); height = view.getUint32(20); type = 'image/png';
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset+4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const length = bytes[offset]*256+bytes[offset+1];
      if (length < 2 || offset+length > bytes.length) break;
      if ([192,193,194].includes(marker) && length >= 7) {
        height=bytes[offset+3]*256+bytes[offset+4]; width=bytes[offset+5]*256+bytes[offset+6]; type='image/jpeg'; break;
      }
      offset += length;
    }
  }
  if (!type || width < 1 || height < 1 || width*height > 16000000) throw new Error('PHOTO_INVALID');
  return type;
}

export async function importImage(value: string, fetcher: typeof fetch = fetch) {
  const source = validateSource(value);
  let result = await download(source,fetcher);
  if (result.type === 'text/html') {
    const candidate = extractImageUrl(new TextDecoder().decode(result.bytes),result.url);
    result = await download(candidate,fetcher);
  }
  const type = imageType(result.bytes);
  if (type !== result.type) throw new Error('PHOTO_INVALID');
  let binary = '';
  for (let start=0; start<result.bytes.length; start+=8192) binary += String.fromCharCode(...result.bytes.subarray(start,start+8192));
  return { dataUri: `data:${type};base64,${btoa(binary)}`, sourceUrl: source.href };
}
