import { OnePick } from '@/constants/onepick';

// Canvas helpers shared by the Pick card and the profile card. Both cards draw on the same
// surface at the same size, so the drawing primitives live here rather than in each card.

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

export function clean(value: string, max: number) {
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

function splitLongToken(ctx: any, token: string, maxWidth: number) {
  const parts: string[] = [];
  let current = '';
  for (const character of Array.from(token)) {
    const next = current + character;
    if (current && ctx.measureText(next).width > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function wrapLines(ctx: any, value: string, maxWidth: number, maxLines: number) {
  const rawTokens = clean(value, 240).split(' ').filter(Boolean);
  const tokens = rawTokens.flatMap((token) => ctx.measureText(token).width > maxWidth
    ? splitLongToken(ctx, token, maxWidth)
    : [token]);
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    const next = line ? `${line} ${token}` : token;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = token;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && tokens.length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 2 ? `${last.slice(0, -1)}…` : `${last}…`;
  }
  return lines.slice(0, maxLines);
}

// One line that never wraps. wrapLines() always marks its last allowed line as truncated, so it
// cannot be used with maxLines = 1: a short string would come back clipped.
export function fitLine(ctx: any, value: string, maxWidth: number) {
  const text = clean(value, 240);
  if (!text || ctx.measureText(text).width <= maxWidth) return text;
  let current = '';
  for (const character of Array.from(text)) {
    if (ctx.measureText(`${current}${character}…`).width > maxWidth) break;
    current += character;
  }
  return `${current}…`;
}

export function roundedRect(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const BRAND_LOGO_SRC = '/brand/onepick-logo-horizontal.svg';
const BRAND_LOGO_WIDTH = 260;
const BRAND_LOGO_HEIGHT = BRAND_LOGO_WIDTH * 931 / 4883.77;

// Share cards use the approved outlined SVG itself. Do not recreate the wordmark
// from system fonts: the outline asset is the source of truth for both languages.
export async function drawBrandLockup(ctx: any, web: any, x: number, baselineY: number) {
  if (typeof web.Image !== 'function' || typeof ctx.drawImage !== 'function') {
    throw new Error('IMAGE_CARD_UNSUPPORTED');
  }
  const image = new web.Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('IMAGE_CARD_UNSUPPORTED'));
    image.src = BRAND_LOGO_SRC;
  });
  ctx.drawImage(image, x, baselineY - BRAND_LOGO_HEIGHT, BRAND_LOGO_WIDTH, BRAND_LOGO_HEIGHT);
}

export function drawLines(ctx: any, lines: string[], x: number, startY: number, lineHeight: number) {
  lines.forEach((line, index) => ctx.fillText(line, x, startY + (index * lineHeight)));
}

export function cardFileName(seed: string, fallback: string) {
  const safe = clean(seed, 40).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `onepick-${safe || fallback}.png`;
}

// A card canvas the browser can hand back as a PNG. Throws when the platform cannot draw one.
export function createCardContext(web: any) {
  if (!web.document?.createElement) throw new Error('IMAGE_CARD_UNSUPPORTED');
  const canvas = web.document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) throw new Error('IMAGE_CARD_UNSUPPORTED');
  return { canvas, ctx };
}

export function toCardDataUrl(canvas: any) {
  const dataUrl = canvas.toDataURL?.('image/png');
  if (!dataUrl || typeof dataUrl !== 'string') throw new Error('IMAGE_CARD_UNSUPPORTED');
  return dataUrl;
}

export function dataUrlFile(web: any, dataUrl: string, fileName: string) {
  if (typeof web.File !== 'function' || typeof web.atob !== 'function') return null;
  const encoded = dataUrl.split(',')[1];
  if (!encoded) return null;
  const binary = web.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new web.File([bytes], fileName, { type: 'image/png' });
}

export function downloadCard(web: any, dataUrl: string, fileName: string) {
  const anchor = web.document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  if (web.document.body?.appendChild) web.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove?.();
}
