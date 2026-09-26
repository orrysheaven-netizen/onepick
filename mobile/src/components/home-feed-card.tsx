import { Button, PickCard } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format/relativeTime';
import { categoryWithChannels } from '@/lib/home/homeChannels';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One person's current Pick on Home (docs/people-first-home.md): who → category →
 * item → reason, then "나도 이게 원픽", which opens the normal choose screen (the
 * reader still writes their own reason). Comments live on the item screen, which
 * the card itself opens. Nothing here writes or notifies.
 */
export function HomeFeedCard({ pick, mine, onOpenItem, onOpenProfile, onChooseSame }: {
  pick: HomeFeedPick;
  /** The viewer already has this item as their Pick in this category. */
  mine?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  onChooseSame: () => void;
}) {
  return <PickCard
    categoryName={categoryWithChannels(pick.categoryName, pick.channels)}
    itemName={pick.name}
    review={pick.oneLineReview}
    photo={{ uri: pick.thumbnailUrl, itemId: pick.itemId }}
    person={{ username: pick.username, onPress: onOpenProfile }}
    timeLabel={formatRelativeTime(pick.startedAt)}
    badge={mine ? '내 원픽' : undefined}
    onPress={onOpenItem}
    accessibilityLabel={pick.name + ' 상세 보기'}
    footer={<>
      {mine
        ? <Button variant="ghost" size="sm" label="이미 내 원픽이에요" accessibilityLabel={`${pick.name} 내 한줄평 보기`} onPress={onChooseSame} />
        : <Button variant="soft" size="sm" label="나도 이게 원픽" accessibilityLabel={`${pick.name} 나도 이게 원픽`} onPress={onChooseSame} />}
    </>} />;
}
