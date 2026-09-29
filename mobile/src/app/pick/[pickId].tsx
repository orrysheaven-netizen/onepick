import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickReplies } from '@/components/pick-replies';
import { Avatar, StateCard } from '@/components/ui';
import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { usePickDetail } from '@/hooks/usePickDetail';
import { observabilityService } from '@/services';

type Params = { pickId?: string };

export default function PickConversationScreen() {
  const { pickId } = useLocalSearchParams<Params>();
  const router = useRouter();
  const session = useAuthSession();
  const pickQuery = usePickDetail(pickId, session.user?.id);
  const itemId = pickQuery.data?.pick.itemId;
  const itemQuery = useItemDetail(
    itemId,
    session.user?.id,
    pickId,
    false,
    !session.isLoading && !session.error && Boolean(itemId),
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

  const focused = itemQuery.data?.picks.find((entry) => entry.pick.id === pickId) ?? null;
  const loading = session.isLoading || pickQuery.isPending || (Boolean(itemId) && itemQuery.isPending);
  const loadError = session.error || pickQuery.error || itemQuery.error;

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (itemId) {
      router.replace({ pathname: '/item/[itemId]', params: { itemId } });
    } else {
      router.replace('/');
    }
  };

  if (loading) {
    return <SafeAreaView style={styles.page} edges={['top']}>
      <View style={styles.center}><ActivityIndicator color={OnePick.actionPrimary} /><Text style={styles.stateText}>대화를 불러오고 있어요</Text></View>
    </SafeAreaView>;
  }

  if (loadError || !pickId || !pickQuery.data || !itemQuery.data || !focused) {
    return <SafeAreaView style={styles.page} edges={['top']}>
      <View style={styles.center}>
        <StateCard tone="danger" title="대화를 볼 수 없어요"
          text="삭제되었거나 지금 볼 수 없는 한줄평일 수 있어요."
          action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => {
            void pickQuery.refetch();
            if (itemId) void itemQuery.refetch();
          } }} />
        <Pressable accessibilityRole="button" onPress={goBack} style={styles.textButton}><Text style={styles.textButtonLabel}>돌아가기</Text></Pressable>
      </View>
    </SafeAreaView>;
  }

  const { pick, profile } = focused;
  const isCurrent = pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review');
  const isDeleted = pick.isDeleted ?? false;

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 화면으로" onPress={goBack} style={styles.headerAction}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{itemQuery.data.item.name}</Text>
        <View style={styles.headerAction} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.reviewCard}>
          <View style={styles.authorRow}>
            <Avatar name={profile?.username ?? '?'} size={32} />
            <View style={styles.authorCopy}>
              <Text style={styles.author}>{profile ? `@${profile.username}` : '사용자'}</Text>
              {isCurrent ? <Text style={styles.currentBadge}>✓ 이 집 원픽</Text> : null}
            </View>
          </View>

          {isDeleted
            ? <Text style={styles.deleted}>삭제된 한줄평입니다. 기존 대화만 남아 있어요.</Text>
            : <Text style={styles.review}>“{pick.oneLineReview}”</Text>}
          <Text style={styles.commentCount}>댓글 {pick.commentCount ?? 0}</Text>
        </View>

        <PickReplies pickId={pick.id} canWrite={Boolean(pick.canComment)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: {
    minHeight: 56,
    paddingHorizontal: OnePickSpace.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OnePick.borderDefault,
  },
  headerAction: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  back: { ...OnePickType.title, color: OnePick.textPrimary },
  headerTitle: { ...OnePickType.headline, color: OnePick.textPrimary, flex: 1, textAlign: 'center' },
  content: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingBottom: OnePickSpace.xxxl,
  },
  reviewCard: {
    paddingVertical: OnePickSpace.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OnePick.borderDefault,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  authorCopy: { flex: 1, minWidth: 0 },
  author: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  currentBadge: { ...OnePickType.captionMedium, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  review: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.md },
  deleted: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.md },
  commentCount: { ...OnePickType.captionMedium, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  center: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: OnePickSpace.md, paddingHorizontal: OnePickSpace.gutter },
  stateText: { ...OnePickType.body, color: OnePick.textSecondary },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: OnePickSpace.md },
  textButtonLabel: { ...OnePickType.bodyMedium, color: OnePick.actionPrimary },
});
