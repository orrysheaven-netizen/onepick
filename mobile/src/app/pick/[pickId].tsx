import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurrentPickFlag } from '@/components/current-pick-flag';
import { PickReplies } from '@/components/pick-replies';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useReadNotificationGroup } from '@/hooks/useNotifications';
import { usePickDetail } from '@/hooks/usePickDetail';
import { itemTitle } from '@/lib/items/itemTitle';
import { observabilityService } from '@/services';
import { Icon } from '@/components/ui';

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


// Existing share/login-return route and the single review conversation detail.
export default function PickDetailScreen() {
  const params = useLocalSearchParams<Params>();
  const pickId = typeof params.pickId === 'string' ? params.pickId : undefined;
  const routeItemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  const routeFocusCommentId = typeof params.focusCommentId === 'string' ? params.focusCommentId : undefined;
  const notificationGroupId = typeof params.notificationGroupId === 'string' ? params.notificationGroupId : undefined;
  const notificationSnapshot = typeof params.notificationSnapshot === 'string' ? params.notificationSnapshot : undefined;
  const notificationKind = typeof params.notificationKind === 'string' ? params.notificationKind : undefined;
  const rootCommentId = typeof params.rootCommentId === 'string' ? params.rootCommentId : undefined;
  const commentInitialCursor = typeof params.commentAfterTime === 'string' && typeof params.commentAfterId === 'string'
    ? { timestamp: params.commentAfterTime, id: params.commentAfterId }
    : null;

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
  const publicFoodChannel = OnePickFeatures.foodChannelPicker ? undefined : OnePickMvp.publicPickChannel;
  const itemQuery = useItemDetail(itemId, user?.id, pickId, false, Boolean(itemId) && !hiddenFutureChannel, publicFoodChannel, true);
  const readNotificationGroup = useReadNotificationGroup(user?.id);
  const trackedPickId = useRef<string | undefined>(undefined);
  const acknowledgedNotification = useRef<string | undefined>(undefined);
  const [replyTargetLoaded, setReplyTargetLoaded] = useState(false);

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

  const focused = useMemo(
    () => itemQuery.data?.picks.find(({ pick }) => pick.id === pickId) ?? null,
    [itemQuery.data?.picks, pickId],
  );
  const focusedItemHasPhoto = Boolean(itemQuery.data?.item && [
    itemQuery.data.item.imagePath,
    itemQuery.data.item.imageUrl,
    itemQuery.data.item.thumbnailUrl,
    itemQuery.data.item.imageSourceUrl,
  ].some((value) => typeof value === 'string' && value.trim().length > 0));
  const hiddenPhotoLessPick = Boolean(
    focused
    && focused.pick.userId !== user?.id
    && !focusedItemHasPhoto
  );

  useEffect(() => {
    if (!user || !focused || !notificationGroupId || !notificationSnapshot) return;
    if (notificationKind === 'reply' && !replyTargetLoaded) return;
    const receipt = notificationGroupId + ':' + notificationSnapshot;
    if (acknowledgedNotification.current === receipt) return;
    acknowledgedNotification.current = receipt;
    void readNotificationGroup.mutateAsync({ groupId: notificationGroupId, snapshot: notificationSnapshot })
      .catch(() => {
        if (acknowledgedNotification.current === receipt) acknowledgedNotification.current = undefined;
      });
  }, [focused?.pick.id, notificationGroupId, notificationSnapshot, notificationKind, replyTargetLoaded, user?.id]);

  const loading = (needsPickLookup && pickQuery.isPending) || (!hiddenFutureChannel && Boolean(itemId) && itemQuery.isPending);
  const failed = (needsPickLookup && pickQuery.isError)
    || (!hiddenFutureChannel && (itemQuery.isError || (!loading && (!itemId || !focused))));
  const title = itemQuery.data
    ? itemTitle(itemQuery.data.item.name, itemQuery.data.category?.name, itemQuery.data.isRestaurant)
    : pickQuery.data?.item?.name ?? '한줄평 대화';

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (itemId) router.replace({ pathname: '/item/[itemId]', params: { itemId } });
    else router.replace('/');
  };

  return (
    <SafeAreaView style={styles.page} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 화면" onPress={goBack} style={styles.headerSide}>
          <Icon name="back" />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSide} />
      </View>

      {loading ? <View style={styles.state}><ActivityIndicator /><Text style={styles.stateText}>한줄평 대화를 불러오고 있어요.</Text></View>
        : hiddenFutureChannel ? <View style={styles.state}>
          <Text style={styles.stateTitle}>현재 공개 중인 원픽이 아니에요.</Text>
          <Text style={styles.stateText}>지금은 매장에서 고른 음식 원픽만 공개하고 있어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.retry}>
            <Text style={styles.retryText}>홈으로</Text>
          </Pressable>
        </View>
        : hiddenPhotoLessPick ? <View style={styles.state}>
          <Text style={styles.stateTitle}>현재 공개 중인 원픽이 아니에요.</Text>
          <Text style={styles.stateText}>사진이 있는 원픽만 공개하고 있어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.retry}>
            <Text style={styles.retryText}>홈으로</Text>
          </Pressable>
        </View>
        : failed || !focused ? <View style={styles.state}>
          <Text style={styles.stateTitle}>한줄평을 볼 수 없어요.</Text>
          <Text style={styles.stateText}>삭제됐거나 공개되지 않은 한줄평일 수 있어요.</Text>
          <Pressable accessibilityRole="button" onPress={() => { if (needsPickLookup) void pickQuery.refetch(); if (itemId) void itemQuery.refetch(); }} style={styles.retry}>
            <Text style={styles.retryText}>다시 불러오기</Text>
          </Pressable>
        </View>
        : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* #757: profile rows open this screen as one button, so it carries the item and store links. */}
          {itemQuery.data ? <View style={styles.links}>
            <Pressable accessibilityRole="link" accessibilityLabel={`${title} 메뉴 상세 보기`}
              onPress={() => router.push({ pathname: '/item/[itemId]', params: { itemId: itemQuery.data!.item.id } })}
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.linkText}>메뉴 상세 보기</Text>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
            </Pressable>
            {itemQuery.data.item.providerId ? <Pressable accessibilityRole="link" accessibilityLabel={`${itemQuery.data.item.name} 매장 보기`}
              onPress={() => router.push({ pathname: '/provider/[providerId]', params: { providerId: itemQuery.data!.item.providerId!, scope: 'provider' } })}
              style={({ pressed }) => [styles.linkRow, styles.linkRowDivider, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.linkText}>매장 보기</Text>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
            </Pressable> : null}
          </View> : null}
          <View style={styles.review}>
            <View style={styles.reviewMeta}>
              <Text style={styles.author}>
                {focused.profile ? '@' + focused.profile.username : focused.pick.userId === user?.id ? '내 한줄평' : '사용자'}
              </Text>
              {focused.pick.isCurrent ? <CurrentPickFlag mine={focused.pick.userId === user?.id} /> : null}
            </View>
            {focused.pick.isDeleted
              ? <Text style={styles.reviewText}>삭제된 한줄평이에요. 기존 대화만 남아 있어요.</Text>
              : <Text style={styles.reviewText}>{'“' + focused.pick.oneLineReview + '”'}</Text>}
          </View>
          <PickReplies
            pickId={focused.pick.id}
            canWrite={Boolean(focused.pick.canComment)}
            focusCommentId={notificationKind === 'reply' ? rootCommentId : routeFocusCommentId}
            initialCursor={notificationKind === 'reply' ? commentInitialCursor : null}
            onFocusLoaded={notificationKind === 'reply' ? () => setReplyTargetLoaded(true) : undefined}
          />
        </ScrollView>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OnePick.borderDefault,
  },
  headerSide: { width: 48, minHeight: 44, justifyContent: 'center' },
  headerTitle: { ...OnePickType.headline, flex: 1, color: OnePick.textPrimary, textAlign: 'center' },
  content: { width: '100%', maxWidth: 390, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, paddingBottom: OnePickSpace.xxxl },
  links: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: OnePick.borderDefault },
  linkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: OnePickSpace.sm },
  linkRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: OnePick.borderDefault },
  linkText: { ...OnePickType.bodyMedium, flex: 1, color: OnePick.textPrimary },
  pressed: { opacity: 0.7 },
  review: { paddingVertical: OnePickSpace.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: OnePick.borderDefault },
  reviewMeta: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  author: { ...OnePickType.bodyMedium, flex: 1, color: OnePick.textPrimary },
  reviewText: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.sm },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: OnePickSpace.sm, padding: OnePickSpace.xxl },
  stateTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  stateText: { ...OnePickType.body, color: OnePick.textSecondary, textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: OnePickSpace.lg },
  retryText: { ...OnePickType.bodyMedium, color: OnePick.actionPrimary },
});
