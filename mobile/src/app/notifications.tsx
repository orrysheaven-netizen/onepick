import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotifications, useReadNotification } from '@/hooks/useNotifications';
import type { AppNotification } from '@/services/notificationService';

function notificationMessage(item: AppNotification) {
  if (item.kind === 'seller_request') return `요청한 온라인 판매처 ${item.item_name}이(가) 등록됐어요. 지금 원픽으로 골라보세요.`;
  return item.kind === 'comment' ? `${item.item_name} 원픽에 댓글을 남겼어요.` : `${item.item_name}을(를) 원픽으로 골랐어요.`;
}

function notificationLabel(item: AppNotification) {
  const state = item.read_at ? '읽은' : '새';
  if (item.kind === 'seller_request') return `${state} 알림, 요청한 온라인 판매처 ${item.item_name}이(가) 등록됐어요`;
  return `${state} 알림, @${item.username}님이 ${item.kind === 'comment' ? `${item.item_name} 원픽에 댓글을 남겼어요` : `${item.item_name}을(를) 원픽으로 골랐어요`}`;
}

function formatNotificationTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString('ko-KR') : '시간 정보 없음';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const session = useAuthSession();
  const ready = !session.isLoading && !session.error && Boolean(session.user);
  const query = useNotifications(session.user?.id, ready);
  const read = useReadNotification(session.user?.id);
  const keyOf = (item: AppNotification) => `${item.kind}:${item.id}`;
  const items = ready ? query.data?.pages.flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => keyOf(other) === keyOf(item)) === index) ?? [] : [];
  const loading = session.isLoading || (ready && query.isPending && items.length === 0);
  const refresh = () => { if (ready && !query.isFetching) void query.refetch(); };
  const open = (item: AppNotification) => {
    if (!ready) return;
    if (item.kind === 'seller_request') {
      // The linked online seller is ready to be picked in its category.
      if (!item.item_id || !item.category_id) return;
      router.push({ pathname: '/pick/choose', params: { itemId: item.item_id, categoryId: item.category_id } });
    } else if (item.pick_id) {
      router.push({ pathname: '/pick/[pickId]', params: { pickId: item.pick_id } });
    } else return;
    if (!item.read_at) void read.mutateAsync({ kind: item.kind, id: item.id }).catch(() => undefined);
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="홈으로" style={styles.action} onPress={() => router.replace('/')}><Text style={styles.link}>‹ 홈</Text></Pressable>
      <Text style={styles.title}>알림</Text>
      {ready ? <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={refresh} style={styles.action}><Text style={styles.link}>새로고침</Text></Pressable> : <View style={styles.action} />}
    </View>
    <FlatList
      data={items}
      keyExtractor={keyOf}
      contentContainerStyle={styles.content}
      refreshControl={ready ? <RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} /> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button"
        accessibilityLabel={notificationLabel(item)}
        onPress={() => open(item)}
        style={({ pressed }) => [styles.card, !item.read_at && styles.unread, pressed && { opacity: 0.65 }]}>
        <View style={styles.row}><Text style={styles.sender}>{item.kind === 'seller_request' ? '원픽 운영팀' : `@${item.username}`}</Text>{!item.read_at ? <Text style={styles.newLabel}>{item.kind === 'comment' ? '새 댓글' : item.kind === 'seller_request' ? '요청 완료' : '새 원픽'}</Text> : null}</View>
        <Text style={styles.message}>{notificationMessage(item)}</Text>
        {item.body ? <Text style={styles.body} numberOfLines={3}>{item.kind === 'comment' ? item.body : item.kind === 'seller_request' ? `${item.body} · 온라인` : `“${item.body}”`}</Text> : null}
        <Text style={styles.time}>{formatNotificationTime(item.created_at)}</Text>
      </Pressable>}
      ListHeaderComponent={ready && query.isError && items.length > 0
        ? <Text accessibilityRole="alert" style={styles.error}>새 알림을 갱신하지 못했어요. 마지막으로 불러온 알림을 표시합니다.</Text>
        : null}
      ListEmptyComponent={<View style={styles.empty}>
        {loading ? <><ActivityIndicator color={OnePick.accent} /><Text style={styles.message}>알림을 불러오고 있어요.</Text></>
          : session.error ? <><Text style={styles.message}>로그인 상태를 확인하지 못했어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={session.retry}><Text style={styles.link}>다시 시도</Text></Pressable></>
          : !session.user ? <><Text style={styles.message}>로그인하면 내 원픽에 달린 댓글과 팔로우한 사람의 새 원픽을 확인할 수 있어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={() => router.push('/auth/login')}><Text style={styles.link}>로그인</Text></Pressable></>
          : query.isError ? <><Text accessibilityRole="alert" style={styles.message}>알림을 불러오지 못했어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={refresh}><Text style={styles.link}>다시 불러오기</Text></Pressable></>
          : <><Text style={styles.sender}>아직 알림이 없어요</Text><Text style={styles.message}>내 원픽에 새 댓글이 달리거나 팔로우한 사람이 원픽을 고르면 여기에 알려드려요.</Text></>}
      </View>}
      ListFooterComponent={ready && query.hasNextPage ? <Pressable accessibilityRole="button" disabled={query.isFetching} style={styles.more} onPress={() => { if (!query.isFetching) void query.fetchNextPage(); }}><Text style={styles.link}>{query.isFetchingNextPage ? '불러오는 중…' : '이전 알림 더 보기'}</Text></Pressable> : null}
    />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, minHeight: 68 },
  title: { color: OnePick.text, fontSize: 22, fontWeight: '800' },
  action: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  link: { color: OnePick.accent, fontSize: 14, fontWeight: '600' },
  content: { padding: 20, paddingBottom: 32 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, padding: 18, marginBottom: 12 },
  unread: { backgroundColor: OnePick.accentSoft },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  sender: { fontSize: 16, color: OnePick.text, fontWeight: '700' },
  newLabel: { fontSize: 12, color: OnePick.accent, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 22, color: OnePick.muted, marginTop: 6 },
  body: { fontSize: 16, lineHeight: 24, color: OnePick.text, marginTop: 12 },
  time: { fontSize: 12, color: OnePick.muted, marginTop: 12 },
  empty: { paddingVertical: 48, alignItems: 'center', gap: 10 },
  error: { color: OnePick.danger, fontSize: 14, lineHeight: 22, marginBottom: 12 },
  more: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
});
