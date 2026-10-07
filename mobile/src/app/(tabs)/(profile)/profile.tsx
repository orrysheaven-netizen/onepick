import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { ProfileBioEditor } from '@/components/profile-bio-editor';
import { ProfilePickCard } from '@/components/profile-pick-card';
import { ProfileAiPanel } from '@/components/profile-ai-panel';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileFollowCounts } from '@/components/profile-follow-counts';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { SignOutButton } from '@/components/sign-out-button';
import { Avatar, Button, Chip, Icon, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useMyComments, useMyPickHistory, useMyItemRequests } from '@/hooks/useMyProfileLists';
import { categoryWithChannels } from '@/lib/home/homeChannels';
import { filterMainProfileByChannel, splitLabPicks } from '@/lib/profile/profilePickGroups';
import { shareProfile } from '@/lib/share/shareProfile';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';

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

const PROFILE_CHANNEL_LABELS: Record<string, string> = {
  offline: '매장',
  online: '온라인',
  recipe: '레시피',
};

function ProfileCurrentPickRow({
  item,
  isFood,
  onOpenPick,
  onOpenItem,
  onOpenProvider,
}: {
  item: PickReadItem;
  isFood: boolean;
  onOpenPick: (pickId: string) => void;
  onOpenItem: (itemId: string) => void;
  onOpenProvider: (providerId: string) => void;
}) {
  const channel = item.item?.channels?.[0];
  const channelLabel = channel ? PROFILE_CHANNEL_LABELS[channel] : null;
  const title = isFood
    ? item.category?.name ?? item.item?.name ?? '원픽'
    : item.item?.name ?? item.category?.name ?? '원픽';
  const providerName = isFood
    ? (channel === 'recipe' ? item.item?.creatorName ?? '레시피' : item.item?.name ?? '')
    : item.category?.name ?? '';
  const imageUri = item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl;
  // L4: a Pick on a published product waits for its first photo's admin review.
  const waitsForPhoto = item.pick.status === 'needs_review'
    && (item.item?.status === 'active' || item.item?.status === 'discontinued');
  const photoReviewText = !waitsForPhoto ? null : item.item?.photoPendingReview
    ? '사진 검수 중 · 승인되면 다른 사람에게도 보여요.'
    : '사진이 반려됐어요 · 상세에서 다시 올려주세요.';
  const badgeStyle = channel === 'offline'
    ? styles.currentPickBadgeOffline
    : channel === 'online'
      ? styles.currentPickBadgeOnline
      : styles.currentPickBadgeRecipe;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} 원픽 상세 보기`}
      onPress={() => onOpenPick(item.pick.id)}
      style={({ pressed }) => [styles.currentPickRow, pressed && styles.pressed]}>
      <PickPhoto
        size={64}
        uri={imageUri}
        label={title}
        itemId={item.item?.id}
        itemStatus={item.item?.status}
        hasPhoto={Boolean(item.item?.imagePath)}
      />
      <View style={styles.currentPickCopy}>
        <View style={styles.currentPickTitleRow}>
          {item.item ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title} 상세 보기`}
              onPress={(event) => {
                event.stopPropagation();
                onOpenItem(item.item!.id);
              }}
              style={({ pressed }) => [styles.currentPickTitleAction, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={styles.currentPickTitle}>{title}</Text>
            </Pressable>
          ) : <Text numberOfLines={1} style={styles.currentPickTitle}>{title}</Text>}
          {channelLabel ? <View style={[styles.currentPickBadge, badgeStyle]}>
            <Text style={styles.currentPickBadgeText}>{channelLabel}</Text>
          </View> : null}
        </View>
        {providerName ? item.item?.providerId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${providerName} 제공처 프로필 보기`}
            onPress={(event) => {
              event.stopPropagation();
              onOpenProvider(item.item!.providerId!);
            }}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text numberOfLines={1} style={styles.currentPickProvider}>{providerName}</Text>
          </Pressable>
        ) : <Text numberOfLines={1} style={styles.currentPickProvider}>{providerName}</Text> : null}
        {item.pick.oneLineReview ? <Text numberOfLines={1} style={styles.currentPickReview}>“{item.pick.oneLineReview}”</Text> : null}
        {photoReviewText ? <Text numberOfLines={1} style={styles.currentPickPhotoReview}>{photoReviewText}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const profileQuery = useMyProfile(user?.id);
  const isProfileMissing = profileQuery.error instanceof AppError && profileQuery.error.code === 'PROFILE_NOT_FOUND';
  const listUserId = !isSessionLoading && !sessionError && !isProfileMissing && profileQuery.data ? user?.id : undefined;
  const historyQuery = useMyPickHistory(OnePickFeatures.profilePickHistory ? listUserId : undefined);
  const requestsQuery = useMyItemRequests(OnePickFeatures.profileItemRequests ? listUserId : undefined);
  const commentsQuery = useMyComments(listUserId);
  const adminAccess = useAdminAccess(user?.id);
  const categoriesQuery = useExploreCategories(Boolean(user && profileQuery.data));
  const [profileScope, setProfileScope] = useState<'food' | 'other'>('food');
  const [isSharingProfile, setIsSharingProfile] = useState(false);
  const [profileShareError, setProfileShareError] = useState(false);

  if (isSessionLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard loading title="프로필을 확인하고 있어요." />
    </View></SafeAreaView>;
  }
  if (sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
        action={{ label: '다시 확인하기', onPress: retrySession, variant: 'secondary' }} />
    </View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard title="나의 원픽을 모아보세요." text="로그인하면 카테고리마다 고른 원픽을 한곳에서 볼 수 있어요."
        action={{ label: '로그인하기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/login', params: { action: 'profile' } }) }} />
    </View></SafeAreaView>;
  }
  if (isProfileMissing) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard title="프로필을 완성해주세요." text="원픽을 공개하려면 사용할 사용자명을 먼저 정하면 돼요."
        action={{ label: '사용자명 만들기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/username', params: { action: 'profile' } }) }} />
      <SignOutButton />
    </View></SafeAreaView>;
  }
  if (profileQuery.isPending) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard loading title="원픽을 모으고 있어요." /><SignOutButton />
    </View></SafeAreaView>;
  }
  if (!profileQuery.data) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <StateCard tone="danger" title="프로필을 불러오지 못했어요." action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => void profileQuery.refetch() }} />
      <SignOutButton />
    </View></SafeAreaView>;
  }

  const { profile, currentPicks } = profileQuery.data;
  // The profile contract currently stores username rather than a separate display name.
  // Use it in the Figma 03 identity slot until that field exists server-side.
  const displayName = profile.username;
  const loadedCommentCount = commentsQuery.data?.length ?? 0;
  const commentCountLabel = commentsQuery.hasNextPage ? `${loadedCommentCount}+` : String(loadedCommentCount);
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
  const isFetching = profileQuery.isFetching || historyQuery.isFetching || requestsQuery.isFetching || commentsQuery.isFetching;
  const isRefetching = profileQuery.isRefetching || historyQuery.isRefetching || requestsQuery.isRefetching || commentsQuery.isRefetching;
  const refreshAll = async () => {
    if (isFetching) return;
    await Promise.all([
      profileQuery.refetch({ cancelRefetch: false }),
      // refetch() ignores `enabled`, so skip hidden lists explicitly.
      OnePickFeatures.profilePickHistory ? historyQuery.refetch({ cancelRefetch: false }) : null,
      OnePickFeatures.profileItemRequests ? requestsQuery.refetch({ cancelRefetch: false }) : null,
      commentsQuery.refetch({ cancelRefetch: false }),
    ]);
  };
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const openPublicProfile = () => router.push({ pathname: '/u/[username]', params: { username: profile.username, returnTo: '/profile' } });
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
        <View style={styles.profileHeader}>
          <Text numberOfLines={1} style={styles.profileHeaderTitle}>{profile.username}</Text>
          <View style={styles.profileHeaderActions}>
            {profileQuery.isRefetchError ? <Button variant="ghost" size="sm"
              accessibilityLabel={OnePickFeatures.profileItemRequests ? '프로필과 원픽 등록 요청 상태 새로고침' : '프로필 새로고침'}
              disabled={isFetching} onPress={refreshAll} label={isFetching ? '확인 중…' : profileQuery.isRefetchError ? '다시 불러오기' : '새로고침'} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="설정 열기" onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.profileHeaderMenuButton, pressed && styles.pressed]}>
              <Icon name="more" color={OnePick.textPrimary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.profileBody}>
          <View style={styles.identity}>
            <Avatar name={displayName} size={72} tone="subtle" />
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{currentPicks.length}</Text>
                <Text style={styles.statLabel}>원픽</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="내 댓글 보기"
                onPress={() => router.push('/comments')} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
                <Text style={styles.statNumber}>{commentCountLabel}</Text>
                <Text style={styles.statLabel}>댓글</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.bioBlock}>
            <Text numberOfLines={1} style={styles.bioName}>{displayName}</Text>
            <Text numberOfLines={2} style={styles.bioText}>{profile.bio?.trim() || '자기소개를 추가해보세요.'}</Text>
          </View>

          {profileQuery.isRefetchError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 상태를 불러오지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요. 다시 새로고침해주세요.</Text> : null}

          {OnePickFeatures.lab ? <View accessibilityRole="tablist" style={styles.profileScopeTabs}>
            <Chip label="음식" accessibilityLabel="음식 원픽 보기" selected={profileScope === 'food'} onPress={() => setProfileScope('food')} visualStyle={styles.profileScopeChip} />
            <Chip label="기타" accessibilityLabel="다른 취향 원픽 보기" selected={profileScope === 'other'} onPress={() => setProfileScope('other')} visualStyle={styles.profileScopeChip} />
          </View> : null}

          {visibleProfilePicks.length > 0 ? <View style={styles.currentPickList}>
            {visibleProfilePicks.map((item) => <ProfileCurrentPickRow
              key={item.pick.id}
              item={item}
              isFood={profileScope === 'food'}
              onOpenPick={openPick}
              onOpenItem={openItem}
              onOpenProvider={(providerId) => router.push({ pathname: '/provider/[providerId]', params: { providerId, scope: 'provider' } })}
            />)}
          </View> : (
            <StateCard title={profileScope === 'food' ? '첫 원픽을 골라보세요.' : '다른 취향 원픽도 골라보세요.'}
              text={profileScope === 'food' ? '지금 가장 좋아하는 메뉴 하나면 돼요.' : '영화, 게임, 책 같은 취향을 고르면 여기에 모여요.'}
              action={profileScope === 'food'
                ? { label: '원픽 고르러 가기', variant: 'secondary', onPress: () => router.push('/') }
                : { label: '다른 취향 원픽 고르기', variant: 'secondary', onPress: openLab }} />
          )}

          {profileScope === 'other' && visibleProfilePicks.length > 0 ? (
            <Button variant="secondary" fullWidth label="다른 취향 원픽 고르기" accessibilityLabel="실험실에서 다른 취향 원픽 고르기"
              onPress={openLab} style={styles.otherTasteEntry} />
          ) : null}
        </View>

        <View style={styles.managementSection}>
          <Text style={styles.secondaryTitle}>내 프로필 관리</Text>
          <Text style={styles.secondaryDescription}>소개를 고치거나 공개 프로필을 확인해요.</Text>

          <ProfileBioEditor profileUserId={profile.id} bio={profile.bio} />
          {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={profile.id} editable /> : null}
          {OnePickFeatures.followCounts ? <ProfileFollowCounts userId={user.id} /> : null}
          {OnePickFeatures.tasteComposition ? <ProfileTasteComposition profileId={profile.id} viewerId={user.id} /> : null}
          {OnePickFeatures.profileAi ? <ProfileAiPanel profileId={profile.id} currentPickCount={currentPicks.length} /> : null}
          <View style={styles.profileShareRow}>
            <Button variant="secondary" fullWidth label={isSharingProfile ? '공유 중…' : '프로필 공유'}
              accessibilityLabel="내 프로필 공유" disabled={isSharingProfile} onPress={() => void shareMyProfile()} />
            {profileShareError ? <Text accessibilityRole="alert" style={styles.shareError}>프로필을 공유하지 못했어요. 다시 시도해주세요.</Text> : null}
          </View>
          {Platform.OS === 'web' && !profileQuery.isRefetchError ? <Button variant="ghost" size="sm"
            accessibilityLabel={OnePickFeatures.profileItemRequests ? '프로필과 원픽 등록 요청 상태 새로고침' : '프로필 새로고침'}
            disabled={isFetching} onPress={refreshAll} label={isFetching ? '확인 중…' : '새로고침'} /> : null}

          <Pressable onPress={openPublicProfile} style={({ pressed }) => [styles.managementRow, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.managementTitle}>공개 프로필 보기</Text><Text style={styles.managementText}>다른 사람에게 보이는 취향 컬렉션과 공유 화면을 확인해요.</Text></View>
            <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.chevron} />
          </Pressable>
          {adminAccess.data === true ? <Pressable onPress={() => router.push('/admin/dashboard')} style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.adminTitle}>관리자 데이터 관리</Text><Text style={styles.adminText}>승인 대기 제품, 정식 제품, 카테고리와 브랜드를 관리해요.</Text></View><Icon name="chevronRight" size="sm" color={OnePick.onAction} style={styles.adminChevron} />
          </Pressable> : null}
        </View>

        {showRequests || showHistory ? <View style={styles.activitySection}>
          <Text style={styles.secondaryTitle}>활동 기록</Text>
          <Text style={styles.secondaryDescription}>{showRequests ? '원픽 등록 요청 상태를 확인해요.' : '원픽 활동을 확인해요.'}</Text>

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
              itemName={item.item?.name ?? '정보를 확인할 수 없어요.'}
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
    paddingBottom: OnePickSpace.xxxl,
  },
  profileHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileHeaderTitle: { ...OnePickType.title, color: OnePick.textPrimary, flexShrink: 1 },
  profileHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  profileHeaderMenuButton: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  profileBody: { minHeight: 724, paddingTop: 10, gap: OnePickSpace.md },
  identity: { height: 82, flexDirection: 'row', alignItems: 'center', gap: 18 },
  stats: { flexDirection: 'row', alignItems: 'flex-start', gap: 22 },
  stat: { alignItems: 'center' },
  statNumber: { ...OnePickType.headline, color: OnePick.textPrimary },
  statLabel: { ...OnePickType.caption, color: OnePick.textSecondary },
  bioBlock: { gap: 2 },
  bioName: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  bioText: { ...OnePickType.body, color: OnePick.textSecondary },
  listControl: { marginTop: OnePickSpace.md },
  refreshError: { ...OnePickType.body, color: OnePick.textDanger, marginBottom: OnePickSpace.sm },
  actionCopy: { flex: 1 },
  profileShareRow: { gap: OnePickSpace.sm, marginTop: OnePickSpace.md, marginBottom: OnePickSpace.md },
  shareError: { ...OnePickType.caption, color: OnePick.textDanger, textAlign: 'center' },
  profileScopeTabs: { flexDirection: 'row', gap: OnePickSpace.sm },
  profileScopeChip: { paddingHorizontal: 14 },
  otherTasteEntry: { marginTop: OnePickSpace.md },
  currentPickList: { borderTopWidth: 1, borderTopColor: OnePick.borderDefault },
  currentPickRow: {
    height: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
  },
  currentPickCopy: { flex: 1, minWidth: 0, height: 82, gap: 2 },
  currentPickTitleRow: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 7 },
  currentPickTitleAction: { flexShrink: 1, maxWidth: '72%' },
  currentPickTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  currentPickBadge: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: OnePickRadius.sm,
  },
  currentPickBadgeOffline: { backgroundColor: OnePick.bgPlaceholder },
  currentPickBadgeOnline: { backgroundColor: OnePick.bgMuted },
  currentPickBadgeRecipe: { backgroundColor: OnePick.bgAccentSubtle },
  currentPickBadgeText: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  currentPickProvider: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  currentPickReview: { ...OnePickType.caption, color: OnePick.textSecondary },
  currentPickPhotoReview: { ...OnePickType.caption, color: OnePick.textSecondary },
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
  secondaryEyebrow: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
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
  adminChevron: { paddingHorizontal: OnePickSpace.xs },
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
  chevron: { paddingHorizontal: OnePickSpace.xs },
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
