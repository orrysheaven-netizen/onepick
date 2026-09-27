import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { HomeFeedCard } from '@/components/home-feed-card';
import { Button, Chip, SectionHeader, StateCard } from '@/components/ui';
import { useDishPicks, useMyDishPicks } from '@/hooks/useDishPicks';
import { HOME_CHANNEL_TABS } from '@/lib/home/homeChannels';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

type Props = {
  categoryId: string;
  categoryName: string;
  userId?: string;
};

/**
 * Everyone's current Pick for one dish: who → store/recipe → 한줄평, newest
 * first, with the Home channel tabs. The feed leaves the viewer out, so their own
 * Pick for the dish is read separately and shown first as "내 원픽".
 */
export function DishPeoplePicks({ categoryId, categoryName, userId }: Props) {
  const router = useRouter();
  const [channel, setChannel] = useState<PickChannel | null>(null);
  const query = useDishPicks(categoryId, channel, userId);
  const picks = query.data ?? [];
  const mine = (useMyDishPicks(categoryId, userId).data ?? [])
    .filter((pick) => !channel || pick.channels.includes(channel));
  const renderCard = (pick: HomeFeedPick, isMine: boolean) => <View key={pick.pickId} style={styles.cell}>
    <HomeFeedCard pick={pick} mine={isMine}
      onOpenItem={() => router.push({ pathname: '/item/[itemId]', params: { itemId: pick.itemId } })}
      onOpenProfile={() => router.push({ pathname: '/u/[username]', params: { username: pick.username } })}
      onOpenComments={() => router.push({ pathname: '/item/[itemId]', params: { itemId: pick.itemId, pickId: pick.pickId } })} />
  </View>;
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetching) void query.fetchNextPage({ cancelRefetch: false });
  };

  return (
    <View accessibilityLabel={`${categoryName} 사람들의 원픽`} style={styles.container}>
      <SectionHeader title={`사람들의 ${categoryName} 원픽`} description="최근 고른 순 · 누가 어디를 왜 골랐는지 볼 수 있어요" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRow}>
        {HOME_CHANNEL_TABS.map((tab) => <Chip key={tab.label} label={tab.label} selected={tab.channel === channel}
          accessibilityLabel={`${categoryName} ${tab.label} 원픽 보기`} onPress={() => setChannel(tab.channel)} />)}
      </ScrollView>

      {query.isPending ? <StateCard compact loading title="원픽을 불러오고 있어요" /> : null}
      {query.isError && !picks.length ? <StateCard compact tone="danger" title="원픽을 불러오지 못했어요"
        action={{ label: '다시 불러오기', disabled: query.isFetching, onPress: () => void query.refetch({ cancelRefetch: false }) }} /> : null}
      {query.isSuccess && !picks.length ? <StateCard compact title={`아직 다른 사람의 ${categoryName} 원픽이 없어요`}
        text="첫 원픽이 등록되면 이곳에 표시돼요." /> : null}

      {mine.map((pick) => renderCard(pick, true))}
      {picks.map((pick) => renderCard(pick, false))}

      {query.hasNextPage ? <Button variant="ghost" size="sm" label={query.isFetchingNextPage ? '불러오는 중…' : '원픽 더 보기'}
        accessibilityLabel={`${categoryName} 원픽 더 보기`} disabled={query.isFetching} onPress={loadMore} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16 },
  channelRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, paddingRight: 4, marginBottom: 10 },
  cell: { marginBottom: 12 },
});
