import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { FollowButton } from '@/components/follow-button';
import { Avatar, Icon, StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useFollowConnections, usePublicFollowCounts } from '@/hooks/useFollow';
import type { FollowConnection, FollowDirection } from '@/types/domain/safety';

type Props = {
  profileId: string;
  ownerUsername: string;
  viewerUserId?: string;
  initialDirection?: FollowDirection;
  onBack?: () => void;
  onOpenProfile: (username: string) => void;
  onRequireLogin?: (username: string) => void;
};

function tabLabel(direction: FollowDirection, count?: number) {
  const label = direction === 'followers' ? '팔로워' : '팔로잉';
  return typeof count === 'number' ? `${label} ${count.toLocaleString()}` : label;
}

export function FollowConnectionsView({
  profileId,
  ownerUsername,
  viewerUserId,
  initialDirection = 'followers',
  onBack,
  onOpenProfile,
  onRequireLogin,
}: Props) {
  const [direction, setDirection] = useState<FollowDirection>(initialDirection);
  const counts = usePublicFollowCounts(profileId, viewerUserId ?? null);
  const connections = useFollowConnections(profileId, direction, viewerUserId ?? null);

  useEffect(() => {
    setDirection(initialDirection);
  }, [initialDirection]);

  const items = connections.data?.items ?? [];
  const firstLoad = connections.isPending && items.length === 0;
  const firstError = connections.isError && items.length === 0;
  const unavailable = counts.data === null;
  const isOwner = viewerUserId === profileId;

  const followerLabel = tabLabel('followers', counts.data?.followerCount);
  const followingLabel = tabLabel('following', counts.data?.followingCount);

  const loadMore = () => {
    if (!connections.hasNextPage || connections.isFetchingNextPage || connections.isFetchNextPageError) return;
    void connections.fetchNextPage({ cancelRefetch: false });
  };

  const renderRow = ({ item }: { item: FollowConnection }) => (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`@${item.username} 프로필 보기`}
        onPress={() => onOpenProfile(item.username)}
        style={({ pressed }) => [styles.identityAction, pressed && styles.pressed]}>
        <Avatar name={item.username} size={40} tone="subtle" />
        <View style={styles.identityCopy}>
          <Text numberOfLines={1} style={styles.username}>{item.username}</Text>
          {item.bio ? <Text numberOfLines={1} style={styles.bio}>{item.bio}</Text> : null}
        </View>
      </Pressable>
      {viewerUserId !== item.userId ? (
        <FollowButton
          viewerUserId={viewerUserId}
          profileUserId={item.userId}
          username={item.username}
          initialFollowing={item.viewerIsFollowing}
          onRequireLogin={() => onRequireLogin?.(item.username)}
        />
      ) : null}
    </View>
  );

  if (unavailable) {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.headerSide}>
            {onBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="이전 화면"
                onPress={onBack}
                style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
                <Icon name="back" />
              </Pressable>
            ) : null}
          </View>
          <Text numberOfLines={1} accessibilityRole="header" style={styles.owner}>{ownerUsername}</Text>
          <View style={styles.headerSide} />
        </View>
        <View style={styles.stateArea}>
          <StateCard title="프로필을 볼 수 없어요." text="존재하지 않거나 지금은 공개되지 않은 프로필이에요." />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="이전 화면"
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <Icon name="back" />
            </Pressable>
          ) : null}
        </View>
        <Text numberOfLines={1} accessibilityRole="header" style={styles.owner}>{ownerUsername}</Text>
        <View style={styles.headerSide} />
      </View>

      <View accessibilityRole="tablist" style={styles.tabs}>
        {([
          ['followers', followerLabel],
          ['following', followingLabel],
        ] as const).map(([value, label]) => {
          const selected = direction === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => setDirection(value)}
              style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}>
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {firstLoad ? (
        <View style={styles.stateArea}>
          <StateCard loading title={direction === 'followers' ? '팔로워를 불러오고 있어요.' : '팔로잉을 불러오고 있어요.'} />
        </View>
      ) : firstError ? (
        <View style={styles.stateArea}>
          <StateCard
            tone="danger"
            accessibilityRole="alert"
            title={direction === 'followers' ? '팔로워를 불러오지 못했어요.' : '팔로잉을 불러오지 못했어요.'}
            text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{
              label: '다시 불러오기',
              disabled: connections.isFetching,
              onPress: () => { if (!connections.isFetching) void connections.refetch(); },
            }}
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.userId}
          renderItem={renderRow}
          contentContainerStyle={[styles.list, items.length === 0 && styles.listEmpty]}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListEmptyComponent={
            <StateCard
              title={direction === 'followers' ? '아직 팔로워가 없어요.' : isOwner ? '관심 있는 사람을 팔로우해보세요.' : '아직 팔로잉한 사람이 없어요.'}
              text={direction === 'followers'
                ? `@${ownerUsername}님을 팔로우한 사람이 생기면 여기에 보여요.`
                : isOwner ? '팔로우한 사람이 여기에 모여요.' : `@${ownerUsername}님이 팔로우한 사람이 생기면 여기에 보여요.`}
            />
          }
          ListFooterComponent={
            <View style={styles.footer}>
              {connections.isFetchingNextPage ? <ActivityIndicator color={OnePick.actionPrimary} /> : null}
              {connections.isFetchNextPageError ? (
                <StateCard
                  compact
                  tone="danger"
                  text="다음 사용자를 불러오지 못했어요."
                  action={{
                    label: '다시 불러오기',
                    disabled: connections.isFetching,
                    onPress: () => {
                      if (!connections.isFetching) void connections.fetchNextPage({ cancelRefetch: false });
                    },
                  }}
                />
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: {
    minHeight: 56,
    paddingHorizontal: OnePickSpace.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
  },
  headerSide: { width: 44, minHeight: 44, justifyContent: 'center' },
  backButton: { width: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  owner: { ...OnePickType.headline, color: OnePick.textPrimary, flex: 1, textAlign: 'center' },
  tabs: {
    flexDirection: 'row',
    gap: OnePickSpace.sm,
    paddingHorizontal: OnePickSpace.gutter,
    paddingVertical: OnePickSpace.md,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: OnePickRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OnePick.bgSubtle,
  },
  tabSelected: { backgroundColor: OnePick.actionPrimary },
  tabText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  tabTextSelected: { color: OnePick.onAction },
  list: { paddingHorizontal: OnePickSpace.gutter, paddingBottom: OnePickSpace.xxl },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
    paddingVertical: OnePickSpace.md,
  },
  identityAction: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md },
  identityCopy: { flex: 1, minWidth: 0 },
  username: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  bio: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: 2 },
  stateArea: { flex: 1, justifyContent: 'center', padding: OnePickSpace.gutter },
  footer: { minHeight: 32, justifyContent: 'center', paddingVertical: OnePickSpace.sm },
  pressed: { opacity: 0.9 },
});
