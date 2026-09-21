import { createPickShareUrl } from './shareLinks';
import type { SharePickInput } from './sharePick';
import {
  cardFileName, clean, createCardContext, dataUrlFile, downloadCard, drawBrandLockup, drawLines,
  roundedRect, toCardDataUrl, wrapLines, CARD_HEIGHT, CARD_WIDTH,
} from './cardCanvas';
import { OnePick } from '@/constants/onepick';

export type SharePickCardResult = 'shared' | 'downloaded' | 'unsupported';

export async function sharePickCardImage(input: SharePickInput): Promise<SharePickCardResult> {
  const web = globalThis as any;
  const { canvas, ctx } = createCardContext(web);

  const shareUrl = createPickShareUrl(input.pickId);
  const category = clean(input.categoryName, 40);
  const item = clean(input.itemName, 100);
  const review = clean(input.oneLineReview, 240);
  const username = clean(input.username, 50);

  ctx.fillStyle = OnePick.background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.fillStyle = OnePick.surface;
  roundedRect(ctx, 72, 72, 936, 1206, 42);
  ctx.fill();

  drawBrandLockup(ctx, 130, 160);

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
  ctx.fillText('고른 이유', 130, 620);

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

  const dataUrl = toCardDataUrl(canvas);

  const fileName = cardFileName(item, 'pick');
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
