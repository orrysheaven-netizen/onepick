import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotifications, useReadNotification } from '@/hooks/useNotifications';
import type { CommentNotification } from '@/services/notificationService';

export default function NotificationsScreen() {
  const router = useRouter();
  const session = useAuthSession();
  const ready = !session.isLoading && !session.error && Boolean(session.user);
  const query = useNotifications(session.user?.id, ready);
  const read = useReadNotification(session.user?.id);
  const [openError, setOpenError] = useState(false);
  const items = ready && !query.isError ? query.data?.pages.flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.comment_id === item.comment_id) === index) ?? [] : [];
  const loading = session.isLoading || (ready && query.isPending);
  const refresh = () => { if (ready && !query.isFetching) void query.refetch(); };
  const open = async (item: CommentNotification) => {
    if (!ready || read.isPending) return;
    setOpenError(false);
    try {
      await read.mutateAsync(item.comment_id);
      router.push({ pathname: '/pick/[pickId]', params: { pickId: item.pick_id } });
    } catch {
      setOpenError(true);
    }
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="홈으로" style={styles.action} onPress={() => router.replace('/')}><Text style={styles.link}>‹ 홈</Text></Pressable>
      <Text style={styles.title}>알림</Text>
      {ready ? <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={refresh} style={styles.action}><Text style={styles.link}>새로고침</Text></Pressable> : <View style={styles.action} />}
    </View>
    <FlatList
      data={items}
      keyExtractor={(item) => item.comment_id}
      contentContainerStyle={styles.content}
      refreshControl={ready ? <RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} /> : undefined}
      renderItem={({ item }) => <Pressable accessibilityRole="button"
        accessibilityLabel={`${item.read_at ? '읽은' : '새'} 알림, @${item.username}님이 ${item.item_name} 원픽에 댓글을 남겼어요`}
        disabled={read.isPending}
        onPress={() => { void open(item); }}
        style={({ pressed }) => [styles.card, !item.read_at && styles.unread, pressed && { opacity: 0.65 }]}>
        <View style={styles.row}><Text style={styles.sender}>@{item.username}</Text>{!item.read_at ? <Text style={styles.newLabel}>새 댓글</Text> : null}</View>
        <Text style={styles.message}>{item.item_name} 원픽에 댓글을 남겼어요.</Text>
        <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
        <Text style={styles.time}>{new Date(item.created_at).toLocaleString('ko-KR')}</Text>
      </Pressable>}
      ListHeaderComponent={openError && ready ? <Text accessibilityRole="alert" style={styles.error}>알림을 열지 못했어요. 다시 눌러주세요.</Text> : null}
      ListEmptyComponent={<View style={styles.empty}>
        {loading ? <><ActivityIndicator color={OnePick.accent} /><Text style={styles.message}>알림을 불러오고 있어요.</Text></>
          : session.error ? <><Text style={styles.message}>로그인 상태를 확인하지 못했어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={session.retry}><Text style={styles.link}>다시 시도</Text></Pressable></>
          : !session.user ? <><Text style={styles.message}>로그인하면 내 원픽에 달린 댓글을 확인할 수 있어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={() => router.push('/auth/login')}><Text style={styles.link}>로그인</Text></Pressable></>
          : query.isError ? <><Text accessibilityRole="alert" style={styles.message}>알림을 불러오지 못했어요.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={refresh}><Text style={styles.link}>다시 불러오기</Text></Pressable></>
          : <><Text style={styles.sender}>아직 알림이 없어요</Text><Text style={styles.message}>내 원픽에 새 댓글이 달리면 여기에 알려드려요.</Text></>}
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
  error: { color: '#A9482D', fontSize: 14, lineHeight: 22, marginBottom: 12 },
  more: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
});
