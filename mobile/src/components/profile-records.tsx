import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { ProfilePickCard } from '@/components/profile-pick-card';
import { Button, StateCard } from '@/components/ui';
import { OnePick, OnePickFeatures, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { useMyItemRequests, useMyPickHistory } from '@/hooks/useMyProfileLists';
import { categoryWithChannels } from '@/lib/home/homeChannels';

type HistoryQuery = ReturnType<typeof useMyPickHistory>;
type RequestsQuery = ReturnType<typeof useMyItemRequests>;
type ItemRequestItem = Awaited<ReturnType<typeof import('@/services').profileService.getMyItemRequests>>['items'][number];

// 기록 (#757): only the request states a member still acts on stay visible. Approved
// or merged requests already became Picks; hidden ones are not the member's to see.
const VISIBLE_REQUEST_STATUSES = new Set(['pending', 'rejected']);

function ListControls({ query, label }: { query: HistoryQuery | RequestsQuery; label: string }) {
  if (query.isPending) return <ActivityIndicator accessibilityLabel={`${label} 불러오는 중`} />;
  const pageError = query.isFetchNextPageError;
  const refreshError = query.isError && !pageError;
  return (
    <>
      {query.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {pageError ? '다음 목록을 불러오지 못했어요.' : query.data ? '최신 목록을 확인하지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요.' : `${label} 목록을 불러오지 못했어요.`}
        </Text>
      ) : null}
      {query.hasNextPage || query.isError ? (
        <Button
          variant="secondary"
          size="sm"
          accessibilityLabel={`${label} ${query.isError ? '다시 불러오기' : '더 보기'}`}
          disabled={query.isFetching}
          label={query.isFetching ? '불러오는 중…' : query.isError ? '다시 불러오기' : `${label} 더 보기`}
          onPress={() => {
            if (query.isFetching) return;
            if (refreshError) void query.refetch({ cancelRefetch: false });
            else void query.fetchNextPage({ cancelRefetch: false });
          }} />
      ) : null}
    </>
  );
}

function requestState(item: ItemRequestItem) {
  return item.item.status === 'rejected'
    ? { label: '반려', description: '정보를 확인한 결과 등록하지 않았어요.' }
    : { label: '검토 중', description: '관리자가 정보를 확인하고 있어요.' };
}

/** A registration request row. Informational only: the item is not public yet. */
function ItemRequestRow({ item }: { item: ItemRequestItem }) {
  const state = requestState(item);
  return <View style={styles.row}>
    <PickPhoto size={64} uri={item.item.thumbnailUrl ?? item.item.imageUrl ?? item.item.imageSourceUrl} label={item.item.name}
      itemId={item.item.id} itemStatus={item.item.status} hasPhoto={Boolean(item.item.imagePath)} />
    <View style={styles.copy}>
      <View style={styles.meta}>
        <View style={[styles.badge, item.item.status === 'rejected' && styles.badgeRejected]}>
          <Text style={styles.badgeText}>{state.label}</Text>
        </View>
        <Text numberOfLines={1} style={styles.category}>{item.category?.name ?? '카테고리'}</Text>
      </View>
      <Text numberOfLines={1} style={styles.name}>{item.item.name}</Text>
      <Text style={styles.description}>{state.description}</Text>
      {item.item.requestedCategoryLabel ? <Text style={styles.description}>요청한 카테고리: {item.item.requestedCategoryLabel}</Text> : null}
    </View>
  </View>;
}

/**
 * The owner-only 기록 tab (#757): registration requests under review or rejected,
 * then past Picks (replaced or released). A confirmed-empty tab says so once; a list
 * that is still loading or failed keeps its own section so it can retry.
 */
export function ProfileRecords({ historyQuery, requestsQuery, onOpenPick }: {
  historyQuery: HistoryQuery;
  requestsQuery: RequestsQuery;
  onOpenPick: (pickId: string) => void;
}) {
  const requests = (requestsQuery.data ?? []).filter((item) => VISIBLE_REQUEST_STATUSES.has(item.item.status));
  const history = historyQuery.data ?? [];
  const requestsEmpty = !OnePickFeatures.profileItemRequests
    || (requestsQuery.isSuccess && requests.length === 0 && !requestsQuery.hasNextPage);
  const historyEmpty = !OnePickFeatures.profilePickHistory
    || (historyQuery.isSuccess && history.length === 0 && !historyQuery.hasNextPage);

  if (requestsEmpty && historyEmpty) {
    return <StateCard title="아직 기록이 없어요." text="원픽을 바꾸거나 등록을 요청하면 여기에 남아요." />;
  }

  return (
    <View style={styles.sections}>
      {!requestsEmpty ? <View>
        <Text style={styles.sectionTitle}>등록 요청</Text>
        {requests.map((item) => <ItemRequestRow key={item.item.id} item={item} />)}
        <ListControls query={requestsQuery} label="등록 요청" />
      </View> : null}

      {!historyEmpty ? <View>
        <Text style={styles.sectionTitle}>지난 원픽</Text>
        {history.map((item) => <ProfilePickCard
          key={item.pick.id}
          categoryName={categoryWithChannels(item.category?.name ?? '카테고리', item.item?.channels)}
          itemName={item.item?.name ?? '정보를 확인할 수 없어요.'}
          review={item.pick.oneLineReview}
          imageUri={item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl}
          itemId={item.item?.id}
          itemStatus={item.item?.status}
          hasPhoto={Boolean(item.item?.imagePath)}
          muted
          statusText={item.pick.status === 'replaced' ? '다른 원픽으로 바꿨어요.' : '원픽을 해제했어요.'}
          onPressPick={() => onOpenPick(item.pick.id)}
        />)}
        <ListControls query={historyQuery} label="지난 원픽" />
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { gap: OnePickSpace.xxl },
  sectionTitle: { ...OnePickType.headline, color: OnePick.textPrimary, marginBottom: OnePickSpace.xs },
  error: { ...OnePickType.body, color: OnePick.textDanger, marginVertical: OnePickSpace.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    paddingVertical: OnePickSpace.lg,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
  },
  copy: { flex: 1, minWidth: 0, gap: OnePickSpace.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  badge: {
    height: 24,
    justifyContent: 'center',
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgMuted,
    paddingHorizontal: OnePickSpace.sm,
  },
  badgeRejected: { backgroundColor: OnePick.dangerSoft },
  badgeText: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  category: { ...OnePickType.captionMedium, flexShrink: 1, color: OnePick.textSecondary },
  name: { ...OnePickType.headline, color: OnePick.textPrimary },
  description: { ...OnePickType.caption, color: OnePick.textSecondary },
});
