import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileBioEditor } from '@/components/profile-bio-editor';
import { ProfileCurrentPickRow } from '@/components/profile-current-pick-row';
import { ProfileIdentity, type ProfileStat } from '@/components/profile-identity';
import { ProfileAiPanel } from '@/components/profile-ai-panel';
import { ProfileRecords } from '@/components/profile-records';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileTabs, type ProfileTabKey } from '@/components/profile-tabs';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { SignOutButton } from '@/components/sign-out-button';
import { Button, Icon, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { usePublicFollowCounts } from '@/hooks/useFollow';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useMyPickHistory, useMyItemRequests } from '@/hooks/useMyProfileLists';
import { filterMvpProfilePicks, publicProfileShareCount } from '@/lib/profile/profilePickGroups';
import { profileDisplayName, profileHandle } from '@/lib/profile/profileName';
import { shareProfile } from '@/lib/share/shareProfile';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickSpace, OnePickType } from '@/constants/onepick';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const profileQuery = useMyProfile(user?.id);
  const isProfileMissing = profileQuery.error instanceof AppError && profileQuery.error.code === 'PROFILE_NOT_FOUND';
  const listUserId = !isSessionLoading && !sessionError && !isProfileMissing && profileQuery.data ? user?.id : undefined;
  const historyQuery = useMyPickHistory(OnePickFeatures.profilePickHistory ? listUserId : undefined);
  const requestsQuery = useMyItemRequests(OnePickFeatures.profileItemRequests ? listUserId : undefined);
  const followCounts = usePublicFollowCounts(
    OnePickFeatures.profileFollowConnections && listUserId ? profileQuery.data?.profile.id : undefined,
    user?.id ?? null,
  );
  const categoriesQuery = useExploreCategories(Boolean(user && profileQuery.data));
  const [profileTab, setProfileTab] = useState<ProfileTabKey>('picks');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [hasOpenedEditor, setHasOpenedEditor] = useState(false);
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

  const { profile, currentPicks, currentPicksComplete } = profileQuery.data;
  const displayName = profileDisplayName(profile);
  // Early MVP (#757/#879): the list and 원픽 N show only food Picks from a store or an online
  // order. Recipes and other themes stay stored; they are just not listed here yet. Without
  // the category catalog nothing can be classified, so the list waits instead of guessing.
  const categoriesReady = Boolean(categoriesQuery.data);
  const profilePicks = filterMvpProfilePicks(currentPicks, categoriesQuery.data ?? [], OnePickMvp.browseGroupSlug, OnePickMvp.profileFoodChannels);
  const pickCountLabel = categoriesReady ? `${profilePicks.length}${currentPicksComplete === false ? '+' : ''}` : '—';
  const isFetching = profileQuery.isFetching || historyQuery.isFetching || requestsQuery.isFetching || categoriesQuery.isFetching;
  const isRefetching = profileQuery.isRefetching || historyQuery.isRefetching || requestsQuery.isRefetching;
  const refreshAll = async () => {
    if (isFetching) return;
    await Promise.all([
      profileQuery.refetch({ cancelRefetch: false }),
      categoriesQuery.isError ? categoriesQuery.refetch({ cancelRefetch: false }) : null,
      // refetch() ignores `enabled`, so skip hidden lists explicitly.
      OnePickFeatures.profilePickHistory ? historyQuery.refetch({ cancelRefetch: false }) : null,
      OnePickFeatures.profileItemRequests ? requestsQuery.refetch({ cancelRefetch: false }) : null,
    ]);
  };
  const refreshLabel = OnePickFeatures.profileItemRequests ? '프로필과 원픽 등록 요청 상태 새로고침' : '프로필 새로고침';
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openConnections = (direction: 'followers' | 'following') => {
    if (!followCounts.data) return;
    router.push({ pathname: '/u/[username]', params: { username: profile.username, connections: direction, returnTo: '/profile' } });
  };
  // Restored after review: previewing the public view differs from sharing it (decision pending).
  const openPublicProfile = () => router.push({ pathname: '/u/[username]', params: { username: profile.username, returnTo: '/profile' } });
  const shareMyProfile = async () => {
    if (isSharingProfile) return;
    setIsSharingProfile(true);
    setProfileShareError(false);
    try {
      // Share what visitors see: my list also keeps Picks awaiting review, photo-less ones and
      // ones in a hidden category. With no verified catalog, retry it once; if it still is not
      // there, the count is left out rather than shared as 0.
      const catalog = categoriesQuery.data ?? (await categoriesQuery.refetch({ cancelRefetch: false })).data;
      const pickCount = publicProfileShareCount(currentPicks, catalog, OnePickMvp.browseGroupSlug, OnePickMvp.profileFoodChannels);
      await shareProfile({ username: profile.username, pickCount, pickCountComplete: currentPicksComplete });
    } catch {
      setProfileShareError(true);
    } finally {
      setIsSharingProfile(false);
    }
  };
  const stats: ProfileStat[] = [
    { key: 'picks', label: '원픽', value: pickCountLabel },
    ...(OnePickFeatures.profileFollowConnections ? [
      {
        key: 'followers', label: '팔로워', value: followCounts.data ? String(followCounts.data.followerCount) : '—',
        accessibilityLabel: `팔로워 ${followCounts.data?.followerCount ?? '불러오는 중'}명 보기`,
        disabled: !followCounts.data, onPress: () => openConnections('followers'),
      },
      {
        key: 'following', label: '팔로잉', value: followCounts.data ? String(followCounts.data.followingCount) : '—',
        accessibilityLabel: `팔로잉 ${followCounts.data?.followingCount ?? '불러오는 중'}명 보기`,
        disabled: !followCounts.data, onPress: () => openConnections('following'),
      },
    ] : []),
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refreshAll} tintColor={OnePick.accent} />}>
        <View style={styles.profileHeader}>
          <View style={styles.profileHeaderLeading}>
            {Platform.OS === 'web' || profileQuery.isRefetchError ? <Button variant="ghost" size="sm" accessibilityLabel={refreshLabel}
              disabled={isFetching} onPress={refreshAll} label={isFetching ? '확인 중…' : profileQuery.isRefetchError ? '다시 불러오기' : '새로고침'} /> : null}
          </View>
          <View style={styles.profileHeaderActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="설정 열기" onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.profileHeaderIconButton, pressed && styles.pressed]}>
              <Icon name="more" color={OnePick.textPrimary} />
            </Pressable>
          </View>
        </View>

        <ProfileIdentity name={displayName} handle={profileHandle(profile)} bio={profile.bio}
          bioPlaceholder="소개를 적으면 다른 사람이 내 취향을 더 잘 알 수 있어요." stats={stats} />

        {profileQuery.isRefetchError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 상태를 불러오지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요.</Text> : null}

        <View style={styles.profileActions}>
          <Button variant="secondary" size="sm" label="프로필 편집" accessibilityLabel="프로필 편집"
            onPress={() => { setHasOpenedEditor(true); setIsEditingProfile((open) => !open); }} style={styles.profileActionButton} />
          <Button variant="secondary" size="sm" label={isSharingProfile ? '공유 중…' : '프로필 공유'}
            accessibilityLabel="내 프로필 공유하기" disabled={isSharingProfile} onPress={() => void shareMyProfile()} style={styles.profileActionButton} />
        </View>
        {profileShareError ? <Text accessibilityRole="alert" style={styles.shareError}>프로필을 공유하지 못했어요. 다시 시도해주세요.</Text> : null}
        {/* Mounted on first open and then only hidden, so an unsaved bio draft survives
            closing and reopening 프로필 편집. */}
        {hasOpenedEditor ? <View style={[styles.editor, !isEditingProfile && styles.hidden]}>
          <ProfileBioEditor profileUserId={profile.id} bio={profile.bio} />
          {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={profile.id} editable /> : null}
        </View> : null}
        <Button variant="ghost" size="sm" label="공개 프로필 미리 보기" accessibilityLabel="다른 사람에게 보이는 내 프로필 미리 보기"
          onPress={openPublicProfile} style={styles.previewLink} />

        <View style={styles.tabs}><ProfileTabs value={profileTab} onChange={setProfileTab} /></View>

        {profileTab === 'picks' ? <View style={styles.tabBody}>
          {!categoriesReady ? (categoriesQuery.isError
            ? <StateCard tone="danger" title="원픽을 불러오지 못했어요."
              action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => void categoriesQuery.refetch() }} />
            : <StateCard loading title="원픽을 모으고 있어요." />)
          : profilePicks.length > 0 ? <View>
            {profilePicks.map((item) => <ProfileCurrentPickRow
              key={item.pick.id}
              item={item}
              isFood
              showPhotoReview
              onOpenPick={openPick}
            />)}
          </View> : (
            <StateCard title="첫 원픽을 골라보세요." text="지금 가장 좋아하는 메뉴 하나면 돼요."
              action={{ label: '원픽 고르러 가기', variant: 'secondary', onPress: () => router.push('/') }} />
          )}
        </View> : <View style={styles.tabBody}>
          <ProfileRecords historyQuery={historyQuery} requestsQuery={requestsQuery} onOpenPick={openPick} />
        </View>}
        {/* Gated (off in the MVP) optional tools stay below the primary collection. */}
        {OnePickFeatures.tasteComposition ? <ProfileTasteComposition profileId={profile.id} viewerId={user.id} /> : null}
        {OnePickFeatures.profileAi ? <ProfileAiPanel profileId={profile.id} currentPickCount={currentPicks.length} /> : null}
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
    paddingBottom: OnePickSpace.xxl,
  },
  profileHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileHeaderLeading: { flexShrink: 1, minWidth: 0, alignItems: 'flex-start' },
  profileHeaderActions: { flexDirection: 'row', alignItems: 'center', marginRight: -OnePickSpace.sm },
  profileHeaderIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  refreshError: { ...OnePickType.body, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  profileActions: { flexDirection: 'row', gap: OnePickSpace.sm, marginTop: OnePickSpace.lg },
  profileActionButton: { flex: 1 },
  shareError: { ...OnePickType.caption, color: OnePick.textDanger, textAlign: 'center', marginTop: OnePickSpace.sm },
  editor: { marginTop: OnePickSpace.lg },
  hidden: { display: 'none' },
  previewLink: { alignSelf: 'center', marginTop: OnePickSpace.xs },
  tabs: { marginTop: OnePickSpace.xl },
  tabBody: { paddingTop: OnePickSpace.lg, gap: OnePickSpace.md },
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
