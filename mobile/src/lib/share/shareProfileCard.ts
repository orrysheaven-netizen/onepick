export interface ShareProfileCardPick {
  categoryName: string;
  itemName: string;
}

export interface ShareProfileCardAi {
  summary: string;
  isVisible: boolean;
  isStale: boolean;
}

export interface ShareProfileCardInput {
  username: string;
  picks: ShareProfileCardPick[];
  aiComment?: ShareProfileCardAi | null;
}

// 'downloaded' means the image was saved but the link did not reach the clipboard, so the
// caller still owes the user the link.
export type ShareProfileCardResult = 'shared' | 'downloaded-with-link' | 'downloaded';

export async function shareProfileCardImage(_input: ShareProfileCardInput): Promise<ShareProfileCardResult> {
  throw new Error('IMAGE_CARD_UNSUPPORTED');
}
