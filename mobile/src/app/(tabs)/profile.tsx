import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { categoryWithChannels } from '@/lib/home/homeChannels';
import { filterMainProfileByChannel, splitLabPicks } from '@/lib/profile/profilePickGroups';
import { shareProfile } from '@/lib/share/shareProfile';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

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
      return { label: '승인 대기', description: '관리자가 정보를 확인하고 있어요.', targetId: null };
    case 'active':
    case 'discontinued':
      return { label: '승인됨', description: '정식으로 등록됐어요. 상세 화면에서 원픽으로 선택해주세요.', targetId: item.item.id };
    case 'merged':
      return {
        label: '기존 원픽과 연결됨',
        description: item.mergedIntoItem ? `${item.mergedIntoItem.name}(으)로 통합됐어요.` : '이미 정식 등록된 원픽과 연결됐어요.',
        targetId: item.mergedIntoItem && ['active', 'discontinued'].includes(item.mergedIntoItem.status) ? item.mergedIntoItem.id : null,
      };
    case 'rejected':
      return { label: '등록되지 않음', description: '정보를 확인한 결과 정식 등록이 보류됐어요.', targetId: null };
    case 'hidden':
      return { label: '숨김', description: '현재 공개되지 않아요.', targetId: null };
    default:
      return { label: item.item.status, description: '등록 상태를 확인해주세요.', targetId: null };
  }
}

function ItemRequestCard({ item, onOpenItem }: { item: ItemRequestItem; onOpenItem: (itemId: string) => void }) {
  const state = getRequestState(item);
  const category = item.category?.name ?? '카테고리';
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
    {state.targetId ? <Text style={styles.requestAction}>등록된 원픽 보기 ›</Text> : null}
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
  const historyQuery = useMyPickHistory(OnePickFeatures.profilePickHistory ? listUserId : undefined);
  const requestsQuery = useMyItemRequests(OnePickFeatures.profileItemRequests ? listUserId : undefined);
  const adminAccess = useAdminAccess(user?.id);
  const categoriesQuery = useExploreCategories(Boolean(user && profileQuery.data));
  const [profileScope, setProfileScope] = useState<'food' | 'other'>('food');
  const [isSharingProfile, setIsSharingProfile] = useState(false);
  const [profileShareError, setProfileShareError] = useState(false);

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
      <StateCard title="나의 원픽을 모아보세요" text="로그인하면 카테고리마다 고른 원픽을 한곳에서 볼 수 있어요."
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
  const profileCategories = categoriesQuery.data ?? [];
  const { main: mainPicks, lab: labPicks } = splitLabPicks(currentPicks, profileCategories, OnePickMvp.mainThemeCode, OnePickFeatures.lab);
  const publicMainPicks = filterMainProfileByChannel(mainPicks, profileCategories, OnePickMvp.mainThemeCode, OnePickMvp.publicPickChannel);
  const visibleProfilePicks = profileScope === 'food' ? publicMainPicks : labPicks;
  const history = historyQuery.data ?? [];
  const itemRequests = requestsQuery.data ?? [];
  // Only a successfully fetched, exhausted empty list may disappear. Keep its
  // query active so a new request/history entry can make the block visible again.
  const showRequests = OnePickFeatures.profileItemRequests && (!requestsQuery.isSuccess || requestsQuery.isError || itemRequests.length > 0 || requestsQuery.hasNextPage);
  const showHistory = OnePickFeatures.profilePickHistory && (!historyQuery.isSuccess || historyQuery.isError || history.length > 0 || historyQuery.hasNextPage);
  const isFetching = profileQuery.isFetching || historyQuery.isFetching || requestsQuery.isFetching;
  const isRefetching = profileQuery.isRefetching || historyQuery.isRefetching || requestsQuery.isRefetching;
  const refreshAll = async () => {
    if (isFetching) return;
    await Promise.all([
      profileQuery.refetch({ cancelRefetch: false }),
      // refetch() ignores `enabled`, so skip hidden lists explicitly.
      OnePickFeatures.profilePickHistory ? historyQuery.refetch({ cancelRefetch: false }) : null,
      OnePickFeatures.profileItemRequests ? requestsQuery.refetch({ cancelRefetch: false }) : null,
    ]);
  };
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const openPublicProfile = () => router.push({ pathname: '/u/[username]', params: { username: profile.username } });
  const openLab = () => router.push('/lab');
  const shareMyProfile = async () => {
    if (isSharingProfile) return;
    setIsSharingProfile(true);
    setProfileShareError(false);
    try {
      await shareProfile({ username: profile.username, pickCount: publicMainPicks.length });
    } catch {
      setProfileShareError(true);
    } finally {
      setIsSharingProfile(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refreshAll} tintColor={OnePick.accent} />}>
        <View style={styles.header}>
          <Avatar name={profile.username} size={64} />
          <View style={styles.headerCopy}>
            <Text style={styles.username}>@{profile.username}</Text>
          </View>
          {Platform.OS === 'web' || profileQuery.isRefetchError ? <Button variant="ghost" size="sm" accessibilityLabel={OnePickFeatures.profileItemRequests ? '프로필과 원픽 등록 요청 상태 새로고침' : '프로필 새로고침'}
            disabled={isFetching} onPress={refreshAll} label={isFetching ? '확인 중…' : profileQuery.isRefetchError ? '다시 불러오기' : '새로고침'} /> : null}
        </View>
        <ProfileBioEditor profileUserId={profile.id} bio={profile.bio} />
        {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={profile.id} editable /> : null}
        {profileQuery.isRefetchError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 상태를 불러오지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요. 다시 새로고침해주세요.</Text> : null}
        {OnePickFeatures.followCounts ? <ProfileFollowCounts userId={user.id} /> : null}
        {OnePickFeatures.tasteComposition ? <ProfileTasteComposition profileId={profile.id} viewerId={user.id} /> : null}
        {OnePickFeatures.profileAi ? <ProfileAiPanel profileId={profile.id} currentPickCount={currentPicks.length} /> : null}
        <View style={styles.profileShareRow}>
          <Button variant="secondary" fullWidth label={isSharingProfile ? '공유 중…' : '프로필 공유'}
            accessibilityLabel="내 프로필 공유" disabled={isSharingProfile} onPress={() => void shareMyProfile()} />
          {profileShareError ? <Text accessibilityRole="alert" style={styles.shareError}>프로필을 공유하지 못했어요. 다시 시도해주세요.</Text> : null}
        </View>
        {OnePickFeatures.lab ? <View accessibilityRole="tablist" style={styles.profileScopeTabs}>
          <Pressable accessibilityRole="tab" accessibilityLabel="음식 원픽 보기" accessibilityState={{ selected: profileScope === 'food' }}
            onPress={() => setProfileScope('food')} style={({ pressed }) => [styles.profileScopeTab, profileScope === 'food' && styles.profileScopeTabSelected, pressed && styles.pressed]}>
            <Text style={[styles.profileScopeText, profileScope === 'food' && styles.profileScopeTextSelected]}>음식</Text>
          </Pressable>
          <Pressable accessibilityRole="tab" accessibilityLabel="다른 취향 원픽 보기" accessibilityState={{ selected: profileScope === 'other' }}
            onPress={() => setProfileScope('other')} style={({ pressed }) => [styles.profileScopeTab, profileScope === 'other' && styles.profileScopeTabSelected, pressed && styles.pressed]}>
            <Text style={[styles.profileScopeText, profileScope === 'other' && styles.profileScopeTextSelected]}>다른 취향</Text>
          </Pressable>
        </View> : null}
        <View style={styles.sectionHeader}><SectionHeader title={profileScope === 'food' ? '음식 원픽' : '다른 취향'} count={visibleProfilePicks.length}
          description={profileScope === 'food' ? '지금 가장 좋아하는 메뉴별 하나' : '음식 밖에서 고른 지금의 원픽'} /></View>
        {visibleProfilePicks.length > 0 ? (
          <ProfilePickGroups
            picks={visibleProfilePicks}
            categories={categoriesQuery.data ?? []}
            onPressPick={openPick}
            onPressItem={openItem}
            onPressProvider={(providerId) => router.push({ pathname: '/provider/[providerId]', params: { providerId } })}
          />
        ) : (
          <StateCard title={profileScope === 'food' ? '아직 고른 음식 원픽이 없어요' : '아직 다른 취향 원픽이 없어요'}
            text={profileScope === 'food' ? '홈에서 지금 가장 좋아하는 하나를 골라보세요.' : '영화·게임·책 같은 다른 취향을 고르면 여기에 모여요.'}
            action={profileScope === 'food'
              ? { label: '원픽 고르러 가기', variant: 'secondary', onPress: () => router.push('/') }
              : { label: '다른 취향 원픽 고르기', variant: 'secondary', onPress: openLab }} />
        )}
        {/* The 실험실 is the only place to pick 영화·책·게임 and other non-food themes. */}
        {profileScope === 'other' && visibleProfilePicks.length > 0 ? (
          <Button variant="secondary" fullWidth label="다른 취향 원픽 고르기" accessibilityLabel="실험실에서 다른 취향 원픽 고르기"
            onPress={openLab} style={styles.otherTasteEntry} />
        ) : null}

        <View style={styles.managementSection}>
          <Text style={styles.secondaryTitle}>내 프로필 관리</Text>
          <Text style={styles.secondaryDescription}>취향 선택을 이어가거나 공개 프로필을 확인해요.</Text>

          <Pressable onPress={() => router.push('/onboarding')} style={({ pressed }) => [styles.managementRow, styles.managementRowAccent, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.managementTitle}>취향 고르기 이어가기</Text><Text style={styles.managementText}>아직 고르지 않은 카테고리의 원픽을 더 채워보세요.</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <Pressable onPress={openPublicProfile} style={({ pressed }) => [styles.managementRow, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.managementTitle}>공개 프로필 보기</Text><Text style={styles.managementText}>다른 사람에게 보이는 취향 컬렉션과 공유 화면을 확인합니다.</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="내 댓글 보기" onPress={() => router.push('/comments')}
            style={({ pressed }) => [styles.managementRow, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.managementTitle}>댓글</Text><Text style={styles.managementText}>내가 작성한 댓글과 답글을 확인합니다.</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          {adminAccess.data === true ? <Pressable onPress={() => router.push('/admin/dashboard')} style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.adminTitle}>관리자 데이터 관리</Text><Text style={styles.adminText}>승인 대기 제품, 정식 제품, 카테고리와 브랜드를 관리합니다.</Text></View><Text style={styles.adminChevron}>›</Text>
          </Pressable> : null}
        </View>

        {showRequests || showHistory ? <View style={styles.activitySection}>
          <Text style={styles.secondaryTitle}>활동 기록</Text>
          <Text style={styles.secondaryDescription}>{showRequests ? '원픽 등록 요청 상태를 확인합니다.' : '원픽 활동을 확인합니다.'}</Text>

          {showRequests ? <>
            <View style={[styles.sectionHeader, styles.requestHeader]}>
              <Text style={styles.activitySectionTitle}>내 원픽 등록 요청</Text>
            </View>
            {itemRequests.map((item) => <ItemRequestCard key={item.item.id} item={item} onOpenItem={openItem} />)}
            <ListControls query={requestsQuery} label="등록 요청" />
          </> : null}

          {showHistory ? <>
            <View style={[styles.sectionHeader, styles.historyHeader]}><Text style={styles.activitySectionTitle}>원픽 활동</Text></View>
            {history.map((item) => <ProfilePickCard
              key={item.pick.id}
              categoryName={categoryWithChannels(item.category?.name ?? '카테고리', item.item?.channels)}
              itemName={item.item?.name ?? '정보를 확인할 수 없어요'}
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
            <ListControls query={historyQuery} label="활동" />
          </> : null}
        </View> : null}

        <View style={styles.signOutArea}><SignOutButton /></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  content: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingTop: OnePickSpace.xxl,
    paddingBottom: OnePickSpace.xxxl,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: OnePickSpace.lg },
  headerCopy: { flex: 1, marginLeft: OnePickSpace.lg },
  listControl: { marginTop: OnePickSpace.md },
  refreshError: { ...OnePickType.body, color: OnePick.textDanger, marginBottom: OnePickSpace.sm },
  username: { ...OnePickType.title, color: OnePick.textPrimary },
  bio: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    backgroundColor: OnePick.bgDefault,
    borderRadius: OnePickRadius.lg,
    paddingHorizontal: OnePickSpace.lg,
    paddingVertical: OnePickSpace.md,
    marginBottom: OnePickSpace.sm,
  },
  summaryNumber: { ...OnePickType.headline, color: OnePick.textPrimary },
  summaryLabel: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  actionCopy: { flex: 1 },
  profileShareRow: { gap: OnePickSpace.sm, marginTop: OnePickSpace.md, marginBottom: OnePickSpace.md },
  shareError: { ...OnePickType.caption, color: OnePick.textDanger, textAlign: 'center' },
  profileScopeTabs: { flexDirection: 'row', gap: OnePickSpace.sm, marginBottom: OnePickSpace.lg },
  otherTasteEntry: { marginTop: OnePickSpace.md },
  profileScopeTab: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: OnePickSpace.md,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgMuted,
  },
  profileScopeTabSelected: { backgroundColor: OnePick.actionPrimary },
  profileScopeText: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  profileScopeTextSelected: { color: OnePick.onAction },
  managementSection: {
    marginTop: OnePickSpace.xxxl,
    paddingTop: OnePickSpace.xxl,
    borderTopWidth: 1,
    borderTopColor: OnePick.borderDefault,
  },
  activitySection: {
    marginTop: OnePickSpace.xxxl,
    paddingTop: OnePickSpace.xxl,
    borderTopWidth: 1,
    borderTopColor: OnePick.borderDefault,
  },
  secondaryEyebrow: { ...OnePickType.captionMedium, color: OnePick.textTertiary },
  secondaryTitle: { ...OnePickType.headline, color: OnePick.textPrimary, marginTop: OnePickSpace.xs },
  secondaryDescription: {
    ...OnePickType.caption,
    color: OnePick.textSecondary,
    marginTop: OnePickSpace.xs,
    marginBottom: OnePickSpace.md,
  },
  managementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    backgroundColor: OnePick.bgDefault,
    borderRadius: OnePickRadius.lg,
    paddingHorizontal: OnePickSpace.lg,
    paddingVertical: OnePickSpace.md,
    marginBottom: OnePickSpace.sm,
  },
  managementRowAccent: { borderColor: OnePick.bgAccentSubtle, backgroundColor: OnePick.bgAccentSubtle },
  managementTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  managementText: {
    ...OnePickType.caption,
    color: OnePick.textSecondary,
    marginTop: OnePickSpace.xs,
    paddingRight: OnePickSpace.md,
  },
  adminButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: OnePick.actionPrimary,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.lg,
  },
  adminTitle: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  adminText: {
    ...OnePickType.caption,
    color: OnePick.onAction,
    marginTop: OnePickSpace.xs,
    paddingRight: OnePickSpace.md,
  },
  adminChevron: { ...OnePickType.title, color: OnePick.onAction, paddingHorizontal: OnePickSpace.xs },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: OnePickSpace.sm,
  },
  requestHeader: { marginTop: OnePickSpace.xs },
  historyHeader: { marginTop: OnePickSpace.xxl },
  activitySectionTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  sectionHint: { ...OnePickType.caption, color: OnePick.textSecondary },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    backgroundColor: OnePick.bgDefault,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.md,
    marginBottom: OnePickSpace.md,
  },
  requestActionArea: { flex: 1, minHeight: 86, justifyContent: 'center' },
  requestCopy: { flex: 1, paddingLeft: OnePickSpace.md, paddingVertical: OnePickSpace.xs },
  requestTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: OnePickSpace.sm,
  },
  requestCategory: { ...OnePickType.captionMedium, flex: 1, color: OnePick.textSecondary },
  requestBadge: {
    borderRadius: OnePickRadius.sm,
    backgroundColor: OnePick.bgMuted,
    paddingHorizontal: OnePickSpace.sm,
    paddingVertical: OnePickSpace.xs,
  },
  requestBadgeDone: { backgroundColor: OnePick.bgAccentSubtle },
  requestBadgeText: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  requestBadgeTextDone: { color: OnePick.textAccent },
  requestName: { ...OnePickType.headline, color: OnePick.textPrimary, marginTop: OnePickSpace.xs },
  requestDescription: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  requestAction: { ...OnePickType.captionMedium, color: OnePick.textAccent, marginTop: OnePickSpace.sm },
  chevron: { ...OnePickType.title, color: OnePick.textTertiary, paddingHorizontal: OnePickSpace.xs },
  noHistory: { ...OnePickType.caption, color: OnePick.textSecondary, paddingVertical: OnePickSpace.sm },
  signOutArea: {
    marginTop: OnePickSpace.xxl,
    paddingTop: OnePickSpace.lg,
    borderTopWidth: 1,
    borderTopColor: OnePick.borderDefault,
  },
  centerState: {
    flex: 1,
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: OnePickSpace.lg,
    paddingHorizontal: OnePickSpace.gutter,
  },
  pressed: { opacity: 0.7 },
});
