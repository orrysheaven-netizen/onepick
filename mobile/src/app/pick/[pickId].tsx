import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnePick, OnePickFeatures, OnePickMvp, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { usePickDetail } from '@/hooks/usePickDetail';
import { observabilityService } from '@/services';

type Params = {
  pickId?: string;
  itemId?: string;
  focusCommentId?: string;
  notificationGroupId?: string;
  notificationSnapshot?: string;
  notificationKind?: string;
  rootCommentId?: string;
  commentAfterTime?: string;
  commentAfterId?: string;
};

const FORWARDED: (keyof Params)[] = [
  'focusCommentId', 'notificationGroupId', 'notificationSnapshot', 'notificationKind',
  'rootCommentId', 'commentAfterTime', 'commentAfterId',
];

// Existing share/login-return/notification route. There is no separate
// conversation screen any more (user decision 2026-10-04): it hands off to the
// item detail with this review's comment thread expanded.
export default function PickDetailScreen() {
  const params = useLocalSearchParams<Params>();
  const pickId = typeof params.pickId === 'string' ? params.pickId : undefined;
  const routeItemId = typeof params.itemId === 'string' ? params.itemId : undefined;

  const { user } = useAuthSession();
  const router = useRouter();
  const needsPickLookup = !routeItemId;
  const pickQuery = usePickDetail(pickId, user?.id, needsPickLookup);
  const itemId = routeItemId ?? pickQuery.data?.pick.itemId;
  const hiddenFutureChannel = needsPickLookup && Boolean(
    pickQuery.data?.pick.channel
    && !OnePickFeatures.foodChannelPicker
    && pickQuery.data.pick.channel !== OnePickMvp.publicPickChannel
  );
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

  if (pickId && itemId && !hiddenFutureChannel) {
    const forwarded: Record<string, string> = {};
    for (const key of FORWARDED) {
      const value = params[key];
      if (typeof value === 'string') forwarded[key] = value;
    }
    return <Redirect href={{ pathname: '/item/[itemId]', params: { itemId, pickId, thread: '1', ...forwarded } }} />;
  }

  const loading = needsPickLookup && pickQuery.isPending && Boolean(pickId);

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 화면"
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/'); }} style={styles.headerSide}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      {loading ? <View style={styles.state}><ActivityIndicator /><Text style={styles.stateText}>한줄평을 불러오고 있어요</Text></View>
        : hiddenFutureChannel ? <View style={styles.state}>
          <Text style={styles.stateTitle}>현재 공개 중인 원픽이 아니에요</Text>
          <Text style={styles.stateText}>지금은 매장에서 고른 음식 원픽만 공개하고 있어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.retry}>
            <Text style={styles.retryText}>홈으로</Text>
          </Pressable>
        </View>
        : <View style={styles.state}>
          <Text style={styles.stateTitle}>한줄평을 볼 수 없어요</Text>
          <Text style={styles.stateText}>삭제되었거나 공개되지 않은 한줄평일 수 있어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => { void pickQuery.refetch(); }} style={styles.retry}>
            <Text style={styles.retryText}>다시 불러오기</Text>
          </Pressable>
        </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: OnePickSpace.gutter },
  headerSide: { width: 48, minHeight: 44, justifyContent: 'center' },
  back: { ...OnePickType.headline, color: OnePick.textPrimary },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: OnePickSpace.sm, padding: OnePickSpace.xxl },
  stateTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  stateText: { ...OnePickType.body, color: OnePick.textSecondary, textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: OnePickSpace.lg },
  retryText: { ...OnePickType.bodyMedium, color: OnePick.actionPrimary },
});
