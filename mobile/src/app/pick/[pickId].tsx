import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthSession } from '@/hooks/useAuthSession';
import { usePickDetail } from '@/hooks/usePickDetail';
import { observabilityService } from '@/services';
import { OnePick } from '@/constants/onepick';

// Preserve old shared links and login return paths without a second detail screen.
export default function PickDetailScreen() {
  const { pickId, notificationGroupId, notificationSnapshot, notificationKind, notificationReason, rootCommentId, commentAfterTime, commentAfterId } = useLocalSearchParams<{
    pickId?: string;
    notificationGroupId?: string;
    notificationSnapshot?: string;
    notificationKind?: string;
    notificationReason?: string;
    rootCommentId?: string;
    commentAfterTime?: string;
    commentAfterId?: string;
  }>();
  const { user } = useAuthSession();
  const router = useRouter();
  const query = usePickDetail(pickId, user?.id);
  const trackedPickId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!pickId || trackedPickId.current === pickId) return;
    trackedPickId.current = pickId;
    void observabilityService.captureProductEvent({
      eventName: 'pick_link_opened',
      pickId,
      source: 'shared_or_direct',
      path: '/pick/[pickId]',
    });
  }, [pickId]);

  if (!query.isPending && !query.isError && query.data) {
    return <Redirect href={{ pathname: '/item/[itemId]', params: {
      itemId: query.data.pick.itemId,
      pickId: query.data.pick.id,
      ...(notificationGroupId ? { notificationGroupId } : {}),
      ...(notificationSnapshot ? { notificationSnapshot } : {}),
      ...(notificationKind ? { notificationKind } : {}),
      ...(notificationReason ? { notificationReason } : {}),
      ...(rootCommentId ? { rootCommentId } : {}),
      ...(commentAfterTime ? { commentAfterTime } : {}),
      ...(commentAfterId ? { commentAfterId } : {}),
    } }} />;
  }
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.content}>
        {query.isPending ? <><ActivityIndicator /><Text>원픽을 불러오고 있어요</Text></> : (
          <>
            <Text>원픽을 볼 수 없어요</Text>
            <Text>삭제되었거나 볼 수 없는 기록일 수 있어요.</Text>
            <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.button}><Text>다시 불러오기</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.button}><Text>홈으로</Text></Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: OnePick.background },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18 },
});
