import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { HomeFeedCard } from '@/components/home-feed-card';
import { MenuDetailPickCard } from '@/components/menu-detail-pick-card';
import { Button, Chip, SectionHeader, StateCard } from '@/components/ui';
import { OnePick, OnePickType } from '@/constants/onepick';
import { useDishPicks, useMyDishPicks } from '@/hooks/useDishPicks';
import { HOME_CHANNEL_TABS } from '@/lib/home/homeChannels';
import type { PickChannelScope } from '@/lib/home/channelFeedMerge';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { HomeFeedPick } from '@/repositories/interfaces/readRepository';

type Props = {
  categoryId: string;
  categoryName: string;
  userId?: string;
  /** The menu is already named by the surrounding view, so cards use D hierarchy. */
  menuContext?: boolean;
  /** Internal path restored when a public profile opened from this list closes. */
  returnTo?: string;
  /** When set, query only this channel (or these channels) and hide the channel switcher. */
  fixedChannel?: PickChannelScope;
  /** Route scope forwarded to item/pick detail (`home` keeps Home's online Picks visible there). */
  openScope?: string;
  /** Figma 16A menu-detail layout. Default keeps the reusable browse/ranking presentation. */
  variant?: 'default' | 'menuDetail';
};

/**
 * Everyone's current Pick for one dish: who → store/recipe → 한줄평, newest
 * first, with the Home channel tabs. The feed leaves the viewer out, so their own
 * Pick for the dish is read separately and shown first as "내 원픽".
 */
export function DishPeoplePicks({ categoryId, categoryName, userId, menuContext = true, returnTo = '/explore', fixedChannel, openScope, variant = 'default' }: Props) {
  const router = useRouter();
  const [channel, setChannel] = useState<PickChannel | null>(null);
  const activeChannel = fixedChannel ?? channel;
  const activeChannels = activeChannel === null ? null : typeof activeChannel === 'string' ? [activeChannel] : activeChannel;
  const query = useDishPicks(categoryId, activeChannel, userId);
  const picks = query.data ?? [];
  const mine = (useMyDishPicks(categoryId, userId).data ?? [])
    .filter((pick) => !activeChannels || pick.channels.some((one) => activeChannels.includes(one)));
  const scopeParam = openScope ? { scope: openScope } : {};
  const loadedPicks = [...mine, ...picks];
  const itemCounts = loadedPicks.reduce((counts, pick) => {
    counts.set(pick.itemId, (counts.get(pick.itemId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const countSuffix = query.hasNextPage ? '+' : '';
  const totalPickCountLabel = `${loadedPicks.length}${countSuffix}`;

  const renderDefaultCard = (pick: HomeFeedPick, isMine: boolean) => <View key={pick.pickId} style={styles.cell}>
    <HomeFeedCard pick={pick} mine={isMine} menuContext={menuContext}
      onOpenItem={() => router.push({ pathname: '/item/[itemId]', params: { itemId: pick.itemId, ...scopeParam } })}
      onOpenProfile={() => router.push({ pathname: '/u/[username]', params: { username: pick.username, returnTo } })}
      onOpenProvider={pick.providerId ? () => router.push({ pathname: '/provider/[providerId]', params: { providerId: pick.providerId!, scope: 'provider' } }) : undefined}
      onOpenComments={() => router.push({ pathname: '/item/[itemId]', params: { itemId: pick.itemId, pickId: pick.pickId, ...scopeParam } })} />
  </View>;

  const renderMenuDetailCard = (pick: HomeFeedPick) => <MenuDetailPickCard
    key={pick.pickId}
    pick={pick}
    itemPickCountLabel={`${itemCounts.get(pick.itemId) ?? 1}${countSuffix}`}
    onOpenItem={() => router.push({ pathname: '/item/[itemId]', params: { itemId: pick.itemId, ...scopeParam } })}
    onOpenProfile={() => router.push({ pathname: '/u/[username]', params: { username: pick.username, returnTo } })}
    onOpenProvider={pick.providerId ? () => router.push({ pathname: '/provider/[providerId]', params: { providerId: pick.providerId!, scope: 'provider' } }) : undefined}
    onOpenComments={() => router.push({ pathname: '/pick/[pickId]', params: { pickId: pick.pickId, ...scopeParam } })}
  />;
  const loadMore = () => {
    if (query.hasNextPage && !query.isFetching) void query.fetchNextPage({ cancelRefetch: false });
  };

  if (variant === 'menuDetail') {
    return (
      <View accessibilityLabel={`${categoryName} 사람들의 원픽`} style={[styles.container, styles.menuDetailContainer]}>
        <Text accessibilityRole="header" style={styles.menuDetailCount}>원픽 {totalPickCountLabel}</Text>

        {query.isPending ? <StateCard compact loading title="원픽을 불러오고 있어요." /> : null}
        {query.isError && !loadedPicks.length ? <StateCard compact tone="danger" title="원픽을 불러오지 못했어요."
          action={{ label: '다시 불러오기', disabled: query.isFetching, onPress: () => void query.refetch({ cancelRefetch: false }) }} /> : null}
        {query.isSuccess && !loadedPicks.length ? <StateCard compact title={`아직 ${categoryName} 원픽이 없어요.`}
          text="첫 원픽이 등록되면 이곳에 표시돼요." /> : null}

        {mine.map(renderMenuDetailCard)}
        {picks.map(renderMenuDetailCard)}

        {query.hasNextPage ? <Button variant="ghost" size="sm" label={query.isFetchingNextPage ? '불러오는 중…' : '원픽 더 보기'}
          accessibilityLabel={`${categoryName} 원픽 더 보기`} disabled={query.isFetching} onPress={loadMore} /> : null}
      </View>
    );
  }

  return (
    <View accessibilityLabel={`${categoryName} 사람들의 원픽`} style={styles.container}>
      <SectionHeader title={menuContext ? '사람들의 원픽' : `사람들의 ${categoryName} 원픽`}
        description="최근 고른 순 · 누가 어디를 왜 골랐는지 볼 수 있어요." />
      {!fixedChannel ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelRow}>
        {HOME_CHANNEL_TABS.map((tab) => <Chip key={tab.label} label={tab.label} selected={tab.channel === channel}
          accessibilityLabel={`${categoryName} ${tab.label} 원픽 보기`} onPress={() => setChannel(tab.channel)} />)}
      </ScrollView> : null}

      {query.isPending ? <StateCard compact loading title="원픽을 불러오고 있어요." /> : null}
      {query.isError && !picks.length ? <StateCard compact tone="danger" title="원픽을 불러오지 못했어요."
        action={{ label: '다시 불러오기', disabled: query.isFetching, onPress: () => void query.refetch({ cancelRefetch: false }) }} /> : null}
      {query.isSuccess && !picks.length ? <StateCard compact title={`아직 다른 사람의 ${categoryName} 원픽이 없어요.`}
        text="첫 원픽이 등록되면 이곳에 표시돼요." /> : null}

      {mine.map((pick) => renderDefaultCard(pick, true))}
      {picks.map((pick) => renderDefaultCard(pick, false))}

      {query.hasNextPage ? <Button variant="ghost" size="sm" label={query.isFetchingNextPage ? '불러오는 중…' : '원픽 더 보기'}
        accessibilityLabel={`${categoryName} 원픽 더 보기`} disabled={query.isFetching} onPress={loadMore} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16 },
  menuDetailContainer: { marginTop: 0, gap: 10 },
  menuDetailCount: { ...OnePickType.headline, color: OnePick.textPrimary },
  channelRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, paddingRight: 4, marginBottom: 10 },
  cell: { marginBottom: 12 },
});
