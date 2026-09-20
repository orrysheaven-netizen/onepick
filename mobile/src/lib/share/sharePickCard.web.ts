import { createPickShareUrl } from './shareLinks';
import type { SharePickInput } from './sharePick';
import { OnePick } from '@/constants/onepick';

export type SharePickCardResult = 'shared' | 'downloaded' | 'unsupported';

const WIDTH = 1080;
const HEIGHT = 1350;

function clean(value: string, max: number) {
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

function wrapLines(ctx: any, value: string, maxWidth: number, maxLines: number) {
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

function roundedRect(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
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

function drawLines(ctx: any, lines: string[], x: number, startY: number, lineHeight: number) {
  lines.forEach((line, index) => ctx.fillText(line, x, startY + (index * lineHeight)));
}

function cardFileName(itemName: string) {
  const safe = clean(itemName, 40).replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `onepick-${safe || 'pick'}.png`;
}

function dataUrlFile(web: any, dataUrl: string, fileName: string) {
  if (typeof web.File !== 'function' || typeof web.atob !== 'function') return null;
  const encoded = dataUrl.split(',')[1];
  if (!encoded) return null;
  const binary = web.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new web.File([bytes], fileName, { type: 'image/png' });
}

function downloadCard(web: any, dataUrl: string, fileName: string) {
  const anchor = web.document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  if (web.document.body?.appendChild) web.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove?.();
}

export async function sharePickCardImage(input: SharePickInput): Promise<SharePickCardResult> {
  const web = globalThis as any;
  if (!web.document?.createElement) throw new Error('IMAGE_CARD_UNSUPPORTED');

  const canvas = web.document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) throw new Error('IMAGE_CARD_UNSUPPORTED');

  const shareUrl = createPickShareUrl(input.pickId);
  const category = clean(input.categoryName, 40);
  const item = clean(input.itemName, 100);
  const review = clean(input.oneLineReview, 240);
  const username = clean(input.username, 50);

  ctx.fillStyle = OnePick.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = OnePick.surface;
  roundedRect(ctx, 72, 72, 936, 1206, 42);
  ctx.fill();

  ctx.fillStyle = OnePick.accent;
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText('ONE PICK', 130, 160);

  ctx.fillStyle = OnePick.muted;
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText(category, 130, 232);

  ctx.fillStyle = OnePick.text;
  ctx.font = '800 70px system-ui, sans-serif';
  drawLines(ctx, wrapLines(ctx, item, 820, 2), 130, 340, 86);

  ctx.strokeStyle = OnePick.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(130, 535);
  ctx.lineTo(950, 535);
  ctx.stroke();

  ctx.fillStyle = OnePick.accent;
  ctx.font = '700 25px system-ui, sans-serif';
  ctx.fillText('WHY THIS ONE', 130, 620);

  ctx.fillStyle = OnePick.muted;
  ctx.font = '500 42px system-ui, sans-serif';
  const reviewLines = wrapLines(ctx, `“${review}”`, 820, 5);
  drawLines(ctx, reviewLines, 130, 700, 62);

  ctx.fillStyle = OnePick.text;
  ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText(`@${username}`, 130, 1090);

  ctx.fillStyle = OnePick.hint;
  ctx.font = '500 22px system-ui, sans-serif';
  ctx.fillText(clean(shareUrl, 92), 130, 1160);

  ctx.fillStyle = OnePick.accent;
  roundedRect(ctx, 130, 1202, 180, 14, 7);
  ctx.fill();

  const dataUrl = canvas.toDataURL?.('image/png');
  if (!dataUrl || typeof dataUrl !== 'string') throw new Error('IMAGE_CARD_UNSUPPORTED');

  const fileName = cardFileName(item);
  const file = dataUrlFile(web, dataUrl, fileName);
  const nav = web.navigator;
  if (file && nav?.share && nav?.canShare) {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: `${item} · OnePick`,
          text: `@${username}의 ${category} 원픽`,
          url: shareUrl,
        });
        return 'shared';
      }
    } catch (error) {
      if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') throw error;
    }
  }

  downloadCard(web, dataUrl, fileName);
  return 'downloaded';
}
