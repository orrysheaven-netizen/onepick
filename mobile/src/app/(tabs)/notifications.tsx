import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { commentService } from '@/services';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotifications } from '@/hooks/useNotifications';
import type { AppNotificationGroup } from '@/services/notificationService';
import { objectParticle } from '@/lib/home/homeChannels';

function formatNotificationTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('ko-KR') : '시간 정보 없음';
}

function actorLabel(item: AppNotificationGroup) {
  if (!item.actor) return '원픽';
  const base = `@${item.actor.username}`;
  return item.actor_count > 1 ? `${base} 외 ${item.actor_count - 1}명` : base;
}

function describe(item: AppNotificationGroup) {
  const name = item.target.item_name ?? '원픽';
  const sender = actorLabel(item);
  switch (item.kind) {
    case 'pick_review': {
      const message = `${name} 원픽에 새 한줄평이 생겼어요.`;
      return { sender, badge: '새 한줄평', message, label: `${sender}, ${message}` };
    }
    case 'comment': {
      const message = `${name} 내 한줄평에 댓글을 남겼어요.`;
      return { sender, badge: '새 댓글', message, label: `${sender}, ${message}` };
    }
    case 'reply': {
      const message = `${name} 댓글에 답글을 남겼어요.`;
      return { sender, badge: '새 답글', message, label: `${sender}, ${message}` };
    }
    case 'followee_pick': {
      const message = `${name}${objectParticle(name)} 원픽으로 골랐어요.`;
      return { sender, badge: '새 원픽', message, label: `${sender}, ${message}` };
    }
    case 'fix_needed': {
      const message = `${name} 정보를 수정해주세요.`;
      return { sender: '원픽 수정 필요', badge: '수정 필요', message, label: item.reason ? `${message} 사유: ${item.reason}` : message };
    }
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const session = useAuthSession();
  const ready = !session.isLoading && !session.error && Boolean(session.user);
  const query = useNotifications(session.user?.id, ready);
  const items = ready ? query.data?.pages.flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.group_id === item.group_id) === index) ?? [] : [];
  const loading = session.isLoading || (ready && query.isPending && items.length === 0);
  const refresh = () => { if (ready && !query.isFetching) void query.refetch(); };

  const open = async (item: AppNotificationGroup) => {
    if (!ready) return;
    let itemId = item.target.item_id;
    let pickId = item.target.pick_id;
    let rootCommentId = item.target.root_comment_id;
    let commentAfterTime: string | undefined;
    let commentAfterId: string | undefined;

    if (item.kind === 'reply' && rootCommentId) {
      try {
        const location = await commentService.locateComment(rootCommentId);
        if (!location) return;
        itemId = location.itemId;
        pickId = location.pickId;
        rootCommentId = location.rootCommentId;
        commentAfterTime = location.pageCursor?.timestamp;
        commentAfterId = location.pageCursor?.id;
      } catch {
        // Do not navigate or mark read when the exact reply destination cannot be resolved.
        return;
      }
    }

    const params = {
      notificationGroupId: item.group_id,
      notificationSnapshot: item.snapshot,
      notificationKind: item.kind,
      ...(item.reason ? { notificationReason: item.reason } : {}),
      ...(pickId ? { pickId } : {}),
      ...(rootCommentId ? { rootCommentId } : {}),
      ...(commentAfterTime ? { commentAfterTime } : {}),
      ...(commentAfterId ? { commentAfterId } : {}),
    };
    if ((item.kind === 'comment' || item.kind === 'reply') && pickId) {
      router.push({ pathname: '/pick/[pickId]', params: { ...params, pickId } });
    } else if (itemId) {
      router.push({ pathname: '/item/[itemId]', params: { ...params, itemId } });
    } else if (pickId) {
      router.push({ pathname: '/pick/[pickId]', params: { ...params, pickId } });
    }
  };

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>알림</Text>
      {ready ? <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={refresh} style={styles.action}><Text style={styles.link}>새로고침</Text></Pressable> : null}
    </View>
    <FlatList
      data={items}
      keyExtractor={(item) => item.group_id}
      contentContainerStyle={styles.content}
      refreshControl={ready ? <RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} /> : undefined}
      renderItem={({ item }) => {
        const copy = describe(item);
        const unread = item.unread_count > 0;
        return <Pressable accessibilityRole="button"
          accessibilityLabel={`${unread ? '새' : '읽은'} 알림, ${copy.label}`}
          onPress={() => { void open(item); }}
          disabled={!item.target.item_id && !item.target.pick_id}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.65 }]}>
          <View style={styles.row}>
            {unread ? <View accessibilityElementsHidden style={styles.unreadDot} /> : null}
            <Text style={styles.sender}>{copy.sender}</Text>
            {unread ? <Text style={styles.newLabel}>{copy.badge}{item.unread_count > 1 ? ` · ${item.unread_count}` : ''}</Text> : null}
          </View>
          <Text style={styles.message}>{copy.message}</Text>
          {item.kind === 'fix_needed' && item.reason ? <Text style={styles.body} numberOfLines={3}>사유: {item.reason}</Text> : null}
          <Text style={styles.time}>{formatNotificationTime(item.latest_at)}</Text>
        </Pressable>;
      }}
      ListHeaderComponent={ready && query.isError && items.length > 0
        ? <Text accessibilityRole="alert" style={styles.error}>새 알림을 갱신하지 못했어요. 마지막으로 불러온 알림을 표시해요.</Text>
        : null}
      ListEmptyComponent={<View style={styles.empty}>
        {loading ? <><ActivityIndicator color={OnePick.accent} /><Text style={styles.message}>알림을 불러오고 있어요.</Text></>
          : session.error ? <><Text style={styles.message}>로그인 상태를 확인하지 못했어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={session.retry}><Text style={styles.link}>다시 시도</Text></Pressable></>
          : !session.user ? <><Text style={styles.message}>로그인하면 내 원픽의 새 한줄평과 댓글, 팔로우한 사람의 새 원픽, 수정 필요 알림을 확인할 수 있어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={() => router.push({ pathname: '/auth/login', params: { action: 'notifications' } })}><Text style={styles.link}>로그인</Text></Pressable></>
          : query.isError ? <><Text accessibilityRole="alert" style={styles.message}>알림을 불러오지 못했어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={refresh}><Text style={styles.link}>다시 불러오기</Text></Pressable></>
          : <><Text style={styles.sender}>아직 알림이 없어요.</Text><Text style={styles.message}>내 원픽에 새 한줄평이나 댓글이 생기면 여기에 알려드려요.</Text></>}
      </View>}
      ListFooterComponent={ready && query.hasNextPage ? <Pressable accessibilityRole="button" disabled={query.isFetching} style={styles.more} onPress={() => { if (!query.isFetching) void query.fetchNextPage(); }}><Text style={styles.link}>{query.isFetchingNextPage ? '불러오는 중…' : '이전 알림 더 보기'}</Text></Pressable> : null}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: OnePickSpace.gutter,
    minHeight: 56,
  },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  action: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: OnePickSpace.sm,
  },
  link: { ...OnePickType.bodyMedium, color: OnePick.actionPrimary },
  content: { paddingHorizontal: OnePickSpace.gutter, paddingBottom: OnePickSpace.xxxl },
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OnePick.borderDefault,
    backgroundColor: 'transparent',
    paddingVertical: OnePickSpace.lg,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: OnePickSpace.sm,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgAccent,
  },
  sender: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  newLabel: {
    ...OnePickType.captionMedium,
    color: OnePick.textPrimary,
    backgroundColor: OnePick.bgAccentSubtle,
    borderRadius: OnePickRadius.sm,
    paddingHorizontal: OnePickSpace.sm,
    paddingVertical: OnePickSpace.xs,
  },
  message: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.xs },
  body: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  time: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  empty: {
    paddingVertical: OnePickSpace.xxxl + OnePickSpace.lg,
    alignItems: 'center',
    gap: OnePickSpace.sm,
  },
  error: { ...OnePickType.body, color: OnePick.textDanger, marginBottom: OnePickSpace.md },
  more: { alignItems: 'center', minHeight: 52, justifyContent: 'center' },
});
