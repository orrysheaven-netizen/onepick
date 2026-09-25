import { Button, PickCard } from '@/components/ui';
import { formatRelativeTime } from '@/lib/format/relativeTime';
import { homeChannelLabel } from '@/lib/home/homeChannels';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

/**
 * One person's current Pick on Home (docs/people-first-home.md): who → category →
 * item → reason, then two ways to respond. "나도 이게 원픽" opens the normal
 * choose screen (the reader still writes their own reason); "나는 다른 원픽"
 * opens the category's finder. Nothing here writes or notifies.
 */
export function HomeFeedCard({ pick, mine, onOpenItem, onOpenProfile, onOpenPick, onChooseSame, onChooseOther }: {
  pick: HomeFeedPick;
  /** The viewer already has this item as their Pick in this category. */
  mine?: boolean;
  onOpenItem: () => void;
  onOpenProfile: () => void;
  onOpenPick: () => void;
  onChooseSame: () => void;
  onChooseOther: () => void;
}) {
  const channelLabel = homeChannelLabel(pick.channels ?? []);
  return <PickCard
    categoryName={channelLabel ? `${pick.categoryName} · ${channelLabel}` : pick.categoryName}
    itemName={pick.name}
    review={pick.oneLineReview}
    photo={{ uri: pick.thumbnailUrl, itemId: pick.itemId }}
    person={{ username: pick.username, onPress: onOpenProfile }}
    timeLabel={formatRelativeTime(pick.startedAt)}
    badge={mine ? '내 원픽' : undefined}
    onPress={onOpenItem}
    accessibilityLabel={pick.name + ' 제품 상세 보기'}
    footer={<>
      {mine
        ? <Button variant="ghost" size="sm" label="이미 내 원픽이에요" accessibilityLabel={`${pick.name} 내 한줄평 보기`} onPress={onChooseSame} />
        : <Button variant="soft" size="sm" label="나도 이게 원픽" accessibilityLabel={`${pick.name} 나도 이게 원픽`} onPress={onChooseSame} />}
      <Button variant="secondary" size="sm" label="나는 다른 원픽" accessibilityLabel={`${pick.categoryName}에서 나는 다른 원픽 찾기`} onPress={onChooseOther} />
      <Button variant="ghost" size="sm" label="의견 나누기" accessibilityLabel={`@${pick.username}의 원픽에 의견 나누기`} onPress={onOpenPick} />
    </>} />;
}
