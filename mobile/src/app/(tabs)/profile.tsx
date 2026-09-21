import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { ProfileBioEditor } from '@/components/profile-bio-editor';
import { ProfilePickCard } from '@/components/profile-pick-card';
import { ProfilePickGroups } from '@/components/profile-pick-groups';
import { ProfileAiPanel } from '@/components/profile-ai-panel';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileFollowCounts } from '@/components/profile-follow-counts';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { SignOutButton } from '@/components/sign-out-button';
import { Avatar, Button, SectionHeader, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useMyPickHistory, useMyItemRequests } from '@/hooks/useMyProfileLists';
import { categoryLabel } from '@/lib/categories/categoryTree';
import { registrationRoute } from '@/lib/categories/registrationRoute';
import type { Category } from '@/types/domain/category';
import { OnePick, OnePickFeatures } from '@/constants/onepick';

type MyProfileData = Awaited<ReturnType<typeof import('@/services').profileService.getMyProfile>>;
type ItemRequestItem = Awaited<ReturnType<typeof import('@/services').profileService.getMyItemRequests>>['items'][number];

function ListControls({ query, label }: { query: ReturnType<typeof useMyPickHistory> | ReturnType<typeof useMyItemRequests>; label: string }) {
  if (query.isPending) return <ActivityIndicator accessibilityLabel={`${label} 불러오는 중`} />;
  const pageError = query.isFetchNextPageError;
  const refreshError = query.isError && !pageError;
  return (
    <>
      {query.isError ? (
        <Text accessibilityRole="alert" style={styles.refreshError}>
          {pageError ? '다음 목록을 불러오지 못했어요.' : query.data ? '최신 목록을 확인하지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요.' : `${label}을 불러오지 못했어요.`}
        </Text>
      ) : null}
      {query.hasNextPage || query.isError ? (
        <Button
          variant="secondary"
          size="sm"
          style={styles.listControl}
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

function getRequestState(item: ItemRequestItem) {
  switch (item.item.status) {
    case 'pending':
      return { label: '승인 대기', description: '관리자가 제품 정보를 확인하고 있어요.', targetId: null };
    case 'active':
    case 'discontinued':
      return { label: '승인됨', description: '정식 제품으로 등록됐어요. 제품을 열어 원픽으로 선택해주세요.', targetId: item.item.id };
    case 'merged':
      return {
        label: '기존 제품과 연결됨',
        description: item.mergedIntoItem ? `${item.mergedIntoItem.name} 제품으로 통합됐어요.` : '이미 등록된 정식 제품과 연결됐어요.',
        targetId: item.mergedIntoItem && ['active', 'discontinued'].includes(item.mergedIntoItem.status) ? item.mergedIntoItem.id : null,
      };
    case 'rejected':
      return { label: '등록되지 않음', description: '제품 정보를 확인한 결과 정식 등록이 보류됐어요.', targetId: null };
    case 'hidden':
      return { label: '숨김', description: '현재 공개되지 않는 제품이에요.', targetId: null };
    default:
      return { label: item.item.status, description: '제품 상태를 확인해주세요.', targetId: null };
  }
}

function ItemRequestCard({ item, categoryLabel, onOpenItem }: { item: ItemRequestItem; categoryLabel?: string; onOpenItem: (itemId: string) => void }) {
  const state = getRequestState(item);
  const category = categoryLabel ?? item.category?.name ?? '카테고리';
  const copy = <View style={styles.requestCopy}>
    <View style={styles.requestTopRow}>
      <Text style={styles.requestCategory}>{category}</Text>
      <View style={[styles.requestBadge, state.targetId && styles.requestBadgeDone]}>
        <Text style={[styles.requestBadgeText, state.targetId && styles.requestBadgeTextDone]}>{state.label}</Text>
      </View>
    </View>
    <Text style={styles.requestName}>{item.item.name}</Text>
    <Text style={styles.requestDescription}>{state.description}</Text>
    {item.item.requestedCategoryLabel ? <Text style={styles.requestDescription}>요청한 카테고리: {item.item.requestedCategoryLabel}</Text> : null}
    {state.targetId ? <Text style={styles.requestAction}>정식 제품 보기 ›</Text> : null}
  </View>;
  return <View style={styles.requestCard}>
    <PickPhoto uri={item.item.thumbnailUrl ?? item.item.imageUrl ?? item.item.imageSourceUrl} label={item.item.name}
      itemId={item.item.id} itemStatus={item.item.status} hasPhoto={Boolean(item.item.imagePath)} />
    {state.targetId ? <Pressable accessibilityRole="button" onPress={() => onOpenItem(state.targetId!)}
      style={({ pressed }) => [styles.requestActionArea, pressed && styles.pressed]}>{copy}</Pressable> : copy}
  </View>;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const profileQuery = useMyProfile(user?.id);
  const isProfileMissing = profileQuery.error instanceof AppError && profileQuery.error.code === 'PROFILE_NOT_FOUND';
  const listUserId = !isSessionLoading && !sessionError && !isProfileMissing && profileQuery.data ? user?.id : undefined;
  const historyQuery = useMyPickHistory(listUserId);
  const requestsQuery = useMyItemRequests(listUserId);
  const adminAccess = useAdminAccess(user?.id);
  const categoriesQuery = useExploreCategories(Boolean(user && profileQuery.data));

  if (isSessionLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard loading title="프로필을 확인하고 있어요" />
    </View></SafeAreaView>;
  }
  if (sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요" text="연결 상태를 확인한 뒤 다시 시도해주세요."
        action={{ label: '다시 확인하기', onPress: retrySession, variant: 'secondary' }} />
    </View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard title="나의 원픽을 모아보세요" text="로그인하면 카테고리별 현재 원픽과 이전 선택 기록을 한곳에서 볼 수 있어요."
        action={{ label: '로그인하기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/login', params: { action: 'profile' } }) }} />
    </View></SafeAreaView>;
  }
  if (isProfileMissing) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard title="프로필을 완성해주세요" text="원픽을 공개하려면 사용할 사용자명을 먼저 정하면 됩니다."
        action={{ label: '사용자명 만들기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/username', params: { action: 'profile' } }) }} />
      <SignOutButton />
    </View></SafeAreaView>;
  }
  if (profileQuery.isPending) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard loading title="원픽을 모으고 있어요" /><SignOutButton />
    </View></SafeAreaView>;
  }
  if (!profileQuery.data) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard tone="danger" title="프로필을 불러오지 못했어요" action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => void profileQuery.refetch() }} />
      <SignOutButton />
    </View></SafeAreaView>;
  }

  const { profile, currentPicks } = profileQuery.data;
  const history = historyQuery.data ?? [];
  const itemRequests = requestsQuery.data ?? [];
  const categoryCatalog = categoriesQuery.data ?? [];
  // Full path (e.g. 먹을것 › 면류 › 라면) once the taxonomy is loaded; the leaf name until then.
  const labelFor = (category: Category | null | undefined) => category
    ? (categoryCatalog.length ? categoryLabel(category, categoryCatalog) : category.name)
    : undefined;
  const isFetching = profileQuery.isFetching || historyQuery.isFetching || requestsQuery.isFetching;
  const isRefetching = profileQuery.isRefetching || historyQuery.isRefetching || requestsQuery.isRefetching;
  const refreshAll = async () => {
    if (isFetching) return;
    await Promise.all([profileQuery.refetch({ cancelRefetch: false }), historyQuery.refetch({ cancelRefetch: false }), requestsQuery.refetch({ cancelRefetch: false })]);
  };
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const openPublicProfile = () => router.push({ pathname: '/u/[username]', params: { username: profile.username } });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refreshAll} tintColor={OnePick.accent} />}>
        <View style={styles.header}>
          <Avatar name={profile.username} size={64} />
          <View style={styles.headerCopy}>
            <Text style={styles.username}>@{profile.username}</Text>
          </View>
          <Button variant="ghost" size="sm" accessibilityLabel="프로필과 제품 등록 요청 상태 새로고침"
            disabled={isFetching} onPress={refreshAll} label={isFetching ? '확인 중…' : '새로고침'} />
        </View>
        <ProfileBioEditor profileUserId={profile.id} bio={profile.bio} />
        <ProfileSocialLinks profileUserId={profile.id} editable />
        {profileQuery.isRefetchError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 상태를 불러오지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요. 다시 새로고침해주세요.</Text> : null}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>현재 원픽</Text>
          <Text style={styles.summaryNumber}>{currentPicks.length}개</Text>
        </View>
        {OnePickFeatures.follow ? <ProfileFollowCounts userId={user.id} /> : null}
        <ProfileTasteComposition profileId={profile.id} viewerId={user.id} />
        <ProfileAiPanel profileId={profile.id} currentPickCount={currentPicks.length} />
        <View style={styles.sectionHeader}><SectionHeader title="카테고리별 원픽" count={currentPicks.length} description="카테고리마다 하나 · 바꾸면 기록으로 남아요" /></View>
        {currentPicks.length > 0 ? (
          <ProfilePickGroups
            picks={currentPicks}
            categories={categoriesQuery.data ?? []}
            onPressPick={openPick}
            onPressItem={openItem}
            onPressCategory={(category) => router.push(registrationRoute(category))}
          />
        ) : (
          <StateCard title="아직 고른 원픽이 없어요" text="홈에서 지금 가장 좋아하는 하나를 골라보세요."
            action={{ label: '원픽 고르러 가기', variant: 'secondary', onPress: () => router.push('/') }} />
        )}

        <View style={styles.managementSection}>
          <Text style={styles.secondaryEyebrow}>PROFILE TOOLS</Text>
          <Text style={styles.secondaryTitle}>내 프로필 관리</Text>
          <Text style={styles.secondaryDescription}>취향 선택을 이어가거나 공개 프로필과 운영 도구를 확인합니다.</Text>

          <Pressable onPress={() => router.push('/onboarding')} style={({ pressed }) => [styles.managementRow, styles.managementRowAccent, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.managementTitle}>취향 고르기 이어가기</Text><Text style={styles.managementText}>아직 고르지 않은 카테고리의 원픽을 더 채워보세요.</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <Pressable onPress={openPublicProfile} style={({ pressed }) => [styles.managementRow, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.managementTitle}>공개 프로필 보기</Text><Text style={styles.managementText}>다른 사람에게 보이는 취향 컬렉션과 공유 화면을 확인합니다.</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          {adminAccess.data === true ? <Pressable onPress={() => router.push('/admin/dashboard')} style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.adminTitle}>관리자 데이터 관리</Text><Text style={styles.adminText}>승인 대기 제품, 정식 제품, 카테고리와 브랜드를 관리합니다.</Text></View><Text style={styles.adminChevron}>›</Text>
          </Pressable> : null}
        </View>

        <View style={styles.activitySection}>
          <Text style={styles.secondaryEyebrow}>ACTIVITY</Text>
          <Text style={styles.secondaryTitle}>활동 기록</Text>
          <Text style={styles.secondaryDescription}>제품 등록 요청 상태와 이전 원픽 기록을 확인합니다.</Text>

          <View style={[styles.sectionHeader, styles.requestHeader]}>
            <Text style={styles.activitySectionTitle}>내 제품 등록 요청</Text>{requestsQuery.data ? <Text style={styles.sectionHint}>불러온 {itemRequests.length}개</Text> : null}
          </View>
          {itemRequests.map((item) => <ItemRequestCard key={item.item.id} item={item} categoryLabel={labelFor(item.category)} onOpenItem={openItem} />)}
          {requestsQuery.data && itemRequests.length === 0 && !requestsQuery.isError ? <Text style={styles.noHistory}>아직 등록을 요청한 제품이 없어요.</Text> : null}
          <ListControls query={requestsQuery} label="등록 요청" />

          <View style={[styles.sectionHeader, styles.historyHeader]}><Text style={styles.activitySectionTitle}>이전 원픽 기록</Text>{historyQuery.data ? <Text style={styles.sectionHint}>불러온 {history.length}개</Text> : null}</View>
          {history.map((item) => <ProfilePickCard
            key={item.pick.id}
            categoryName={labelFor(item.category) ?? '카테고리'}
            itemName={item.item?.name ?? '제품 정보를 확인할 수 없어요'}
            review={item.pick.oneLineReview}
            imageUri={item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl}
            itemId={item.item?.id}
            itemStatus={item.item?.status}
            hasPhoto={Boolean(item.item?.imagePath)}
            muted
            statusText={item.pick.status === 'replaced' ? '다른 원픽으로 변경됨' : '선택 종료'}
            onPressPick={() => openPick(item.pick.id)}
            onPressItem={item.item ? () => openItem(item.pick.itemId) : undefined}
          />)}
          {historyQuery.data && history.length === 0 && !historyQuery.isError ? <Text style={styles.noHistory}>원픽을 바꾸면 이전 선택이 여기에 차곡차곡 남습니다.</Text> : null}
          <ListControls query={historyQuery} label="이전 기록" />
        </View>

        <View style={styles.signOutArea}><SignOutButton /></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 18 },
  headerCopy: { flex: 1, marginLeft: 16 },
  listControl: { marginTop: 12 },
  refreshError: { color: OnePick.danger, fontSize: 13, lineHeight: 20, marginBottom: 8 },
  username: { color: OnePick.text, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  bio: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 6 },
  summaryNumber: { color: OnePick.text, fontSize: 17, fontWeight: '900' },
  summaryLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  actionCopy: { flex: 1 },
  managementSection: { marginTop: 30, paddingTop: 22, borderTopWidth: 1, borderTopColor: OnePick.border },
  activitySection: { marginTop: 30, paddingTop: 22, borderTopWidth: 1, borderTopColor: OnePick.border },
  secondaryEyebrow: { color: OnePick.hint, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  secondaryTitle: { color: OnePick.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  secondaryDescription: { color: OnePick.hint, fontSize: 11, lineHeight: 16, marginTop: 5, marginBottom: 14 },
  managementRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, marginBottom: 9 },
  managementRowAccent: { borderColor: OnePick.accentSoft, backgroundColor: OnePick.accentSoft },
  managementTitle: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  managementText: { color: OnePick.muted, fontSize: 11, lineHeight: 16, marginTop: 3, paddingRight: 12 },
  adminButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: OnePick.text, borderRadius: 18, padding: 16, marginBottom: 0 },
  adminTitle: { color: OnePick.onAccent, fontSize: 14, fontWeight: '800' },
  adminText: { color: OnePick.border, fontSize: 12, lineHeight: 17, marginTop: 4, paddingRight: 12 },
  adminChevron: { color: OnePick.onAccent, fontSize: 26, paddingHorizontal: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  requestHeader: { marginTop: 2 },
  historyHeader: { marginTop: 24 },
  activitySectionTitle: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  sectionHint: { color: OnePick.muted, fontSize: 12 },
  requestCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 12, marginBottom: 11 },
  requestActionArea: { flex: 1, minHeight: 86, justifyContent: 'center' },
  requestCopy: { flex: 1, paddingLeft: 14, paddingVertical: 3 },
  requestTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  requestCategory: { flex: 1, color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  requestBadge: { borderRadius: 999, backgroundColor: OnePick.sunken, paddingHorizontal: 9, paddingVertical: 5 },
  requestBadgeDone: { backgroundColor: OnePick.accentSoft },
  requestBadgeText: { color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  requestBadgeTextDone: { color: OnePick.accent },
  requestName: { color: OnePick.text, fontSize: 15, fontWeight: '800', marginTop: 6 },
  requestDescription: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  requestAction: { color: OnePick.accent, fontSize: 12, fontWeight: '800', marginTop: 7 },
  chevron: { color: OnePick.hint, fontSize: 26, paddingHorizontal: 4 },
  noHistory: { color: OnePick.muted, fontSize: 12, lineHeight: 19, paddingVertical: 10 },
  signOutArea: { marginTop: 26, paddingTop: 18, borderTopWidth: 1, borderTopColor: OnePick.border },
  centerState: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 20 },
  pressed: { opacity: 0.7 },
});