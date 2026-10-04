import { createProfileShareUrl } from './shareLinks';
import type {
  ShareProfileCardAi, ShareProfileCardInput, ShareProfileCardResult,
} from './shareProfileCard';
import {
  cardFileName, clean, createCardContext, dataUrlFile, downloadCard, drawBrandLockup, drawLines, fitLine,
  roundedRect, toCardDataUrl, wrapLines, CARD_HEIGHT, CARD_WIDTH,
} from './cardCanvas';
import { OnePick } from '@/constants/onepick';

const MAX_PICKS = 4;

// An image cannot be recalled once it is sent, so a private evaluation never reaches the card.
// A stale one would contradict the Picks printed beside it.
export function cardAiSummary(aiComment: ShareProfileCardAi | null | undefined) {
  if (!aiComment || !aiComment.isVisible || aiComment.isStale) return null;
  return clean(aiComment.summary ?? '', 160) || null;
}

export async function shareProfileCardImage(input: ShareProfileCardInput): Promise<ShareProfileCardResult> {
  const web = globalThis as any;
  const { canvas, ctx } = createCardContext(web);

  const username = clean(input.username, 50);
  const shareUrl = createProfileShareUrl(username);
  const picks = input.picks.slice(0, MAX_PICKS);
  const remaining = Math.max(input.picks.length - picks.length, 0);
  const summary = cardAiSummary(input.aiComment);

  ctx.fillStyle = OnePick.background;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.fillStyle = OnePick.surface;
  roundedRect(ctx, 72, 72, 936, 1206, 42);
  ctx.fill();

  drawBrandLockup(ctx, web, 130, 160);

  ctx.fillStyle = OnePick.text;
  ctx.font = '800 70px system-ui, sans-serif';
  ctx.fillText(fitLine(ctx, `@${username}`, 820), 130, 250);

  ctx.strokeStyle = OnePick.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(130, 310);
  ctx.lineTo(950, 310);
  ctx.stroke();

  ctx.fillStyle = OnePick.accent;
  ctx.font = '700 25px system-ui, sans-serif';
  ctx.fillText('현재 원픽', 130, 380);

  if (picks.length === 0) {
    ctx.fillStyle = OnePick.muted;
    ctx.font = '500 36px system-ui, sans-serif';
    ctx.fillText('아직 고른 원픽이 없어요.', 130, 460);
  }

  picks.forEach((pick, index) => {
    const top = 440 + (index * 96);
    ctx.fillStyle = OnePick.muted;
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.fillText(fitLine(ctx, clean(pick.categoryName, 40), 820), 130, top);
    ctx.fillStyle = OnePick.text;
    ctx.font = '800 44px system-ui, sans-serif';
    ctx.fillText(fitLine(ctx, clean(pick.itemName, 100), 820), 130, top + 48);
  });

  if (remaining > 0) {
    ctx.fillStyle = OnePick.textSecondary;
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillText(`외 ${remaining}개`, 130, 828);
  }

  if (summary) {
    ctx.fillStyle = OnePick.accent;
    ctx.font = '700 25px system-ui, sans-serif';
    ctx.fillText('AI 취향평가', 130, 900);
    ctx.fillStyle = OnePick.muted;
    ctx.font = '500 34px system-ui, sans-serif';
    drawLines(ctx, wrapLines(ctx, summary, 820, 3), 130, 955, 50);
  }

  ctx.fillStyle = OnePick.textSecondary;
  ctx.font = '500 22px system-ui, sans-serif';
  ctx.fillText(clean(shareUrl, 92), 130, 1160);

  ctx.fillStyle = OnePick.accent;
  roundedRect(ctx, 130, 1202, 180, 14, 7);
  ctx.fill();

  const dataUrl = toCardDataUrl(canvas);
  const fileName = cardFileName(username, 'profile');
  const file = dataUrlFile(web, dataUrl, fileName);
  const nav = web.navigator;
  // Some share targets drop `url`, so the link rides in the text as well.
  const text = `@${username}의 OnePick · 현재 원픽 ${input.picks.length}개\n${shareUrl}`;

  if (file && nav?.share && nav?.canShare) {
    try {
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `@${username}의 OnePick`, text, url: shareUrl });
        return 'shared';
      }
    } catch (error) {
      if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') throw error;
    }
  }

  downloadCard(web, dataUrl, fileName);

  // A saved image with no link in hand ends the share, so the link goes to the clipboard.
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(shareUrl);
      return 'downloaded-with-link';
    }
  } catch {
    // Reported as a plain download; the caller falls back to the text share.
  }
  return 'downloaded';
}
