import * as Linking from 'expo-linking';
import { useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockUserButton } from '@/components/block-user-button';
import { FollowButton } from '@/components/follow-button';
import { FollowConnectionsView } from '@/components/follow-connections-view';
import { ProfileCurrentPickRow } from '@/components/profile-current-pick-row';
import { ProfileIdentity, type ProfileStat } from '@/components/profile-identity';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileAiComment } from '@/components/profile-ai-comment';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { ReportAction } from '@/components/report-action';
import { Button, Chip, Icon, StateCard } from '@/components/ui';
import { DIALOG_CLOSE_LABEL } from '@/components/ui/dialog-labels';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useProfileAiComment } from '@/hooks/useProfileAi';
import { usePublicFollowCounts } from '@/hooks/useFollow';
import { useSocialSignIn } from '@/hooks/useSocialSignIn';
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { shareProfile } from '@/lib/share/shareProfile';
import { shareProfileCardImage } from '@/lib/share/shareProfileCard';
import { filterMainProfileByChannel, splitLabPicks } from '@/lib/profile/profilePickGroups';
import { profileDisplayName, profileHandle } from '@/lib/profile/profileName';
import { getPostAuthRoute, type AuthIntent } from '@/lib/auth/authIntent';
import { armFollowProfileIntent, clearFollowProfileIntent, consumeFollowProfileIntent } from '@/lib/auth/followProfileIntent';
import { isSeedProfileId } from '@/lib/seedProfiles';
import { useSwipeBackHandler } from '@/lib/navigation/swipeBack';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { SocialAuthProvider } from '@/types/domain/auth';

const SAFE_PROFILE_RETURN_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;
function profileReturnHref(value: string | string[] | undefined): Href | null {
  if (typeof value !== 'string' || value.length > 512 || !SAFE_PROFILE_RETURN_PATH.test(value)) return null;
  if (value === '/auth' || value.startsWith('/auth/') || value === '/admin' || value.startsWith('/admin/')
    || value === '/u' || value.startsWith('/u/')) return null;
  return value as Href;
}

export default function PublicProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { username, connections, returnTo } = useLocalSearchParams<{ username?: string; connections?: string; returnTo?: string }>();
  const { user } = useAuthSession();
  const query = usePublicProfile(username, user?.id);
  const categoriesQuery = useExploreCategories(Boolean(query.data));
  const publicFollowCounts = usePublicFollowCounts(
    OnePickFeatures.profileFollowConnections ? query.data?.profile.id : undefined,
    user?.id ?? null,
  );
  const connectionDirection = connections === 'followers' || connections === 'following' ? connections : null;
  // Always call the hook; an absent profileId disables its network query.
  const aiCommentQuery = useProfileAiComment(OnePickFeatures.profileAi ? query.data?.profile.id : undefined);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  const [profileScope, setProfileScope] = useState<'food' | 'other'>('food');
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
  const [loginTargetUsername, setLoginTargetUsername] = useState<string | null>(null);
  const [followToast, setFollowToast] = useState(false);
  const [autoFollow] = useState(() => typeof username === 'string' && consumeFollowProfileIntent(username));
  const socialSignIn = useSocialSignIn();
  // 실험실 themes stay off the main profile and its share card while the lab is on.
  const profileCategories = categoriesQuery.data ?? [];
  const { main: mainPicks, lab: labPicks } = useMemo(
    () => splitLabPicks(query.data?.currentPicks ?? [], profileCategories, OnePickMvp.mainThemeCode, OnePickFeatures.lab),
    [query.data?.currentPicks, categoriesQuery.data],
  );
  const publicMainPicks = filterMainProfileByChannel(mainPicks, profileCategories, OnePickMvp.mainThemeCode, OnePickMvp.publicPickChannel);
  const publicPickCount = publicMainPicks.length + labPicks.length;
  const visibleProfilePicks = profileScope === 'food' ? publicMainPicks : labPicks;
  const isSeed = Boolean(query.data && isSeedProfileId(query.data.profile.id));
  const isProfileNotFound = Boolean(query.error && typeof query.error === 'object' && 'code' in query.error
    && (query.error as { code?: string }).code === 'PROFILE_NOT_FOUND');
  const returnHref = profileReturnHref(returnTo);
  const goBack = () => {
    if (router.canGoBack()) { router.back(); return; }
    router.replace(returnHref ?? '/');
  };

  const swipeBackResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => gesture.x0 <= 32
      && gesture.dx > 12
      && Math.abs(gesture.dy) < 24,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < 72 || gesture.vx <= 0) return;
      swipeBackRef.current();
    },
  }), []);

  // Native: this route's own edge zone owns swipe-back (native-stack swipe is
  // disabled so JS dismiss/back cannot race a native pop). Web: the root-layout
  // edge (lib/navigation/swipeBack) runs swipeBack via useSwipeBackHandler.
  const openFollowLogin = (targetUsername: string) => {
    setLoginTargetUsername(targetUsername);
    setLoginSheetOpen(true);
  };
  const closeFollowLogin = () => {
    setLoginSheetOpen(false);
    setLoginTargetUsername(null);
  };
  const openConnections = (direction: 'followers' | 'following') => {
    if (!query.data || !publicFollowCounts.data) return;
    router.push({
      pathname: '/u/[username]',
      params: { username: query.data.profile.username, connections: direction },
    });
  };
  const closeConnections = () => {
    // Opened from the own profile's 팔로워/팔로잉 stats: go back to that screen.
    if (returnHref) {
      if (router.canGoBack()) { router.back(); return; }
      router.replace(returnHref);
      return;
    }
    if (query.data) {
      const state = navigation.getState();
      if (!state) {
        router.replace({ pathname: '/u/[username]', params: { username: query.data.profile.username } });
        return;
      }
      const previousRoute = state.index > 0 ? state.routes[state.index - 1] : null;
      const previousParams = previousRoute?.params as { username?: unknown; connections?: unknown } | undefined;
      const hasOwnerProfileBelow = previousRoute?.name === 'u/[username]'
        && previousParams?.username === query.data.profile.username
        && previousParams?.connections === undefined;
      if (hasOwnerProfileBelow && router.canGoBack()) { router.back(); return; }
      router.replace({ pathname: '/u/[username]', params: { username: query.data.profile.username } });
      return;
    }
    router.replace('/');
  };
  // Swipe-back target: follower/following list -> its profile, otherwise the
  // validated origin (returnTo), else the same rule as the header back.
  const swipeBack = () => {
    if (connectionDirection) { closeConnections(); return; }
    if (returnHref) router.dismissTo(returnHref);
    else goBack();
  };
  const swipeBackRef = useRef(swipeBack);
  swipeBackRef.current = swipeBack;
  // Web: the root-layout edge gesture runs this while the profile is focused.
  useSwipeBackHandler(swipeBack, { confirmUnsaved: false });

  useEffect(() => {
    if (Platform.OS === 'web' || !connectionDirection || returnHref || typeof username !== 'string') return;

    const state = navigation.getState();
    if (!state) return;
    const previousRoute = state.index > 0 ? state.routes[state.index - 1] : null;
    const previousParams = previousRoute?.params as { username?: unknown; connections?: unknown } | undefined;
    const hasOwnerProfileBelow = previousRoute?.name === 'u/[username]'
      && previousParams?.username === username
      && previousParams?.connections === undefined;
    if (hasOwnerProfileBelow) return;

    const routes = [
      ...state.routes.slice(0, state.index),
      { name: 'u/[username]', params: { username } },
      { name: 'u/[username]', params: { username, connections: connectionDirection } },
    ];
    navigation.dispatch({
      type: 'RESET',
      payload: {
        index: routes.length - 1,
        routes,
      },
    });
  }, [connectionDirection, navigation, returnHref, username]);

  useEffect(() => {
    if (!followToast) return;
    const timer = setTimeout(() => setFollowToast(false), 2600);
    return () => clearTimeout(timer);
  }, [followToast]);

  const publicStats: ProfileStat[] = [
    { key: 'picks', label: '원픽', value: String(publicPickCount) },
    ...(OnePickFeatures.profileFollowConnections ? [
      {
        key: 'followers', label: '팔로워', value: publicFollowCounts.data ? String(publicFollowCounts.data.followerCount) : '—',
        accessibilityLabel: `팔로워 ${publicFollowCounts.data?.followerCount ?? '불러오는 중'}명 보기`,
        disabled: !publicFollowCounts.data, onPress: () => openConnections('followers'),
      },
      {
        key: 'following', label: '팔로잉', value: publicFollowCounts.data ? String(publicFollowCounts.data.followingCount) : '—',
        accessibilityLabel: `팔로잉 ${publicFollowCounts.data?.followingCount ?? '불러오는 중'}명 보기`,
        disabled: !publicFollowCounts.data, onPress: () => openConnections('following'),
      },
    ] : []),
  ];
  const continueProfileLogin = async (provider: SocialAuthProvider) => {
    if (!query.data || socialSignIn.isPending) return;
    const targetUsername = loginTargetUsername ?? query.data.profile.username;
    const intent: AuthIntent = { action: 'follow_profile', username: targetUsername };
    const redirectTo = Linking.createURL('auth/callback', { queryParams: { ...intent } });
    armFollowProfileIntent(targetUsername);
    try {
      const result = await socialSignIn.mutateAsync({ provider, redirectTo });
      // Web leaves the page for OAuth and consumes the session marker after the
      // callback. Native cancellation stays on this screen, so discard it here.
      if (!result) {
        if (Platform.OS !== 'web') clearFollowProfileIntent();
        return;
      }
      closeFollowLogin();
      router.replace(getPostAuthRoute(intent, !result.profile));
    } catch {
      clearFollowProfileIntent();
      // The login sheet renders the mutation error.
    }
  };

  const handleShare = async () => {
    if (!query.data || isSharing) return;
    const { profile } = query.data;
    const currentPicks = publicMainPicks;
    setIsSharing(true);
    setShareError(false);
    setCardNotice(null);
    try {
      let needsLink = false;
      try {
        const result = await shareProfileCardImage({
          username: profile.username,
          picks: currentPicks.map((entry) => ({
            categoryName: entry.category?.name ?? '',
            itemName: entry.item?.name ?? '',
          })),
          aiComment: OnePickFeatures.profileAi ? (aiCommentQuery.data ?? null) : null,
        });
        if (result === 'downloaded-with-link') {
          setCardNotice('카드 이미지를 저장하고 프로필 링크를 복사했어요.');
        }
        needsLink = result === 'downloaded';
      } catch (error) {
        if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') return;
        needsLink = true;
      }
      if (!needsLink) return;
      await shareProfile({ username: profile.username, pickCount: currentPicks.length });
    } catch {
      setShareError(true);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {Platform.OS !== 'web' ? (
        <View
          testID="public-profile-swipe-edge"
          style={styles.swipeEdgeZone}
          {...swipeBackResponder.panHandlers}
        />
      ) : null}
      {query.data && OnePickFeatures.profileFollowConnections && connectionDirection ? (
        <FollowConnectionsView
          profileId={query.data.profile.id}
          ownerUsername={query.data.profile.username}
          viewerUserId={user?.id}
          initialDirection={connectionDirection}
          onBack={closeConnections}
          onOpenProfile={(targetUsername) => router.push({ pathname: '/u/[username]', params: { username: targetUsername } })}
          onRequireLogin={openFollowLogin}
        />
      ) : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!query.data ? <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="back" /></Pressable> : null}
        {query.isPending ? <View style={styles.stateArea}><StateCard loading title="프로필을 불러오고 있어요." /></View> : null}
        {!query.isPending && isProfileNotFound ? <View style={styles.stateArea}>
          <StateCard title="프로필을 찾을 수 없어요." text="사용자명이 바뀌었거나 존재하지 않는 프로필일 수 있어요."
            action={{ label: '홈으로', variant: 'primary', onPress: () => router.replace('/') }} />
        </View> : null}
        {!query.isPending && query.isError && !isProfileNotFound ? <View style={styles.stateArea}>
          <StateCard
            tone="danger"
            title="프로필을 불러오지 못했어요."
            text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{
              label: query.isFetching ? '다시 불러오는 중…' : '다시 불러오기',
              disabled: query.isFetching,
              onPress: () => { if (!query.isFetching) void query.refetch(); },
            }}
          />
        </View> : null}
        {query.data ? <>
          <View style={styles.publicHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
              style={({ pressed }) => [styles.publicHeaderIconButton, pressed && styles.pressed]}>
              <Icon name="back" />
            </Pressable>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.publicHeaderTitle}>{profileDisplayName(query.data.profile)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="프로필 공유" disabled={isSharing}
              onPress={() => void handleShare()} style={({ pressed }) => [styles.publicHeaderIconButton, pressed && styles.pressed]}>
              <Icon name="share" />
            </Pressable>
          </View>

          <View style={styles.publicBody}>
            <ProfileIdentity
              name={profileDisplayName(query.data.profile)}
              handle={profileHandle(query.data.profile)}
              bio={query.data.profile.bio}
              stats={publicStats}
            />

            {OnePickFeatures.profileFollow && !query.data.isMine ? <FollowButton
              viewerUserId={user?.id}
              profileUserId={query.data.profile.id}
              username={query.data.profile.username}
              autoFollow={autoFollow && Boolean(user)}
              onFollowed={() => setFollowToast(true)}
              onRequireLogin={() => openFollowLogin(query.data.profile.username)}
              fullWidth /> : null}
            {query.data.isMine ? <Button variant="secondary" fullWidth label="내 프로필로 이동" onPress={() => router.replace('/profile')} /> : null}
            {cardNotice ? <Text style={styles.shareNotice}>{cardNotice}</Text> : null}
            {shareError ? <Text accessibilityRole="alert" style={styles.shareError}>공유 창을 열지 못했어요. 다시 시도해주세요.</Text> : null}

            {OnePickFeatures.lab ? <View accessibilityRole="tablist" style={styles.profileScopeTabs}>
              <Chip label="음식" accessibilityLabel="음식 원픽 보기" selected={profileScope === 'food'}
                onPress={() => setProfileScope('food')} visualStyle={styles.profileScopeChip} />
              <Chip label="기타" accessibilityLabel="기타 원픽 보기" selected={profileScope === 'other'}
                onPress={() => setProfileScope('other')} visualStyle={styles.profileScopeChip} />
            </View> : null}

            {visibleProfilePicks.length > 0 ? <View style={styles.publicPickList}>
              {visibleProfilePicks.map((item) => <ProfileCurrentPickRow
                key={item.pick.id}
                item={item}
                isFood={profileScope === 'food'}
                onOpenPick={(pickId) => router.push({ pathname: '/pick/[pickId]', params: { pickId } })}
              />)}
            </View> : <StateCard title={profileScope === 'food' ? '아직 고른 원픽이 없어요.' : '아직 고른 기타 원픽이 없어요.'}
              text={profileScope === 'food' ? '이 사용자가 원픽을 고르면 여기에 보여요.' : '이 사용자가 다른 취향을 고르면 여기에 보여요.'} />}
          </View>

          {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={query.data.profile.id} editable={query.data.isMine} /> : null}
          {OnePickFeatures.tasteComposition ? <ProfileTasteComposition profileId={query.data.profile.id} viewerId={user?.id} variant="public" /> : null}
          {OnePickFeatures.profileAi ? <ProfileAiComment
            profileId={query.data.profile.id}
            showPrivate={query.data.isMine}
            sectionTitle="AI 취향평가"
            sectionDescription="AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요."
          /> : null}

          {!user ? <View style={styles.joinCard}>
            <Text style={styles.joinTitle}>나도 카테고리마다 하나씩 골라볼까요?</Text>
            <Text style={styles.joinText}>{profileDisplayName(query.data.profile)}님처럼 내 원픽을 모아 공개 프로필을 만들 수 있어요.{OnePickFeatures.profileAi ? ' 원픽이 충분히 쌓이면 AI 취향평가도 받을 수 있어요.' : ''}</Text>
            <Button variant="secondary" fullWidth style={styles.joinButton} label="내 원픽 만들기"
              accessibilityLabel="로그인하고 내 원픽 만들기"
              onPress={() => router.push({ pathname: '/auth/login', params: { action: 'join_from_profile' } })} />
          </View> : null}
          {!query.data.isMine && user && !isSeed ? <View style={styles.safetyCard}>
            <Text style={styles.safetyTitle}>사용자 관리</Text>
            <Text style={styles.safetyText}>문제가 있는 프로필은 신고하거나, 더 이상 서로의 콘텐츠를 보지 않도록 차단할 수 있어요.</Text>
            <View style={styles.safetyActions}>
              <ReportAction reporterUserId={user.id} targetType="profile" targetId={query.data.profile.id} />
              <BlockUserButton blockerUserId={user.id} blockedUserId={query.data.profile.id} username={query.data.profile.username} onBlocked={goBack} />
            </View>
          </View> : null}
        </> : null}
      </ScrollView>}
      {followToast && query.data && !connectionDirection ? <View pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>{profileDisplayName(query.data.profile)}님을 팔로우했어요.</Text></View> : null}
      <Modal visible={loginSheetOpen} transparent animationType="slide" onRequestClose={closeFollowLogin}>
        <View style={styles.modalBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="로그인 안내 닫기" onPress={closeFollowLogin} style={StyleSheet.absoluteFill} />
          <View style={styles.loginSheet}>
            <Text style={styles.loginSheetTitle}>로그인하고 @{loginTargetUsername ?? query.data?.profile.username ?? username}님을 팔로우하세요.</Text>
            <Text style={styles.loginSheetText}>로그인하면 바로 팔로우되고 이 프로필로 돌아와요.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="카카오로 계속하기" disabled={socialSignIn.isPending}
              onPress={() => void continueProfileLogin('kakao')} style={({ pressed }) => [styles.providerButton, styles.kakaoButton, pressed && styles.pressed]}>
              <Text style={styles.kakaoText}>카카오로 계속하기</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Apple로 계속하기" disabled={socialSignIn.isPending}
              onPress={() => void continueProfileLogin('apple')} style={({ pressed }) => [styles.providerButton, styles.appleButton, pressed && styles.pressed]}>
              <Text style={styles.appleText}>Apple로 계속하기</Text>
            </Pressable>
            {socialSignIn.isError ? <Text accessibilityRole="alert" style={styles.loginError}>로그인을 완료하지 못했어요. 다시 시도해주세요.</Text> : null}
            <Button variant="ghost" size="sm" label={DIALOG_CLOSE_LABEL} onPress={closeFollowLogin} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  swipeEdgeZone: {
    position: 'absolute',
    zIndex: 100,
    left: 0,
    top: 0,
    bottom: 0,
    width: 32,
  },
  content: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingBottom: OnePickSpace.xxxl + OnePickSpace.xxl,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: OnePickSpace.xs,
    marginLeft: -OnePickSpace.sm,
  },
  publicHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.xs,
    marginHorizontal: -OnePickSpace.sm,
  },
  publicHeaderIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  publicHeaderTitle: { ...OnePickType.headline, flex: 1, minWidth: 0, textAlign: 'center', color: OnePick.textPrimary },
  publicBody: { paddingTop: OnePickSpace.sm, gap: OnePickSpace.lg },
  profileScopeTabs: { flexDirection: 'row', gap: OnePickSpace.sm },
  profileScopeChip: { paddingHorizontal: 13 },
  publicPickList: { borderTopWidth: 1, borderTopColor: OnePick.borderDefault },
  safetyCard: {
    backgroundColor: OnePick.bgMuted,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.lg,
    marginTop: OnePickSpace.xxl,
  },
  safetyTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  safetyText: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  safetyActions: { gap: OnePickSpace.sm, marginTop: OnePickSpace.md },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: OnePickSpace.xxxl,
    backgroundColor: OnePick.actionPrimary,
    borderRadius: OnePickRadius.full,
    paddingHorizontal: OnePickSpace.lg,
    paddingVertical: OnePickSpace.md,
  },
  toastText: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: OnePick.bgOverlay },
  loginSheet: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    backgroundColor: OnePick.bgDefault,
    borderTopLeftRadius: OnePickRadius.xl,
    borderTopRightRadius: OnePickRadius.xl,
    paddingHorizontal: OnePickSpace.gutter,
    paddingTop: OnePickSpace.xxl,
    paddingBottom: OnePickSpace.xxl,
    gap: OnePickSpace.md,
  },
  loginSheetTitle: { ...OnePickType.headline, color: OnePick.textPrimary, textAlign: 'center' },
  loginSheetText: {
    ...OnePickType.body,
    color: OnePick.textSecondary,
    textAlign: 'center',
    marginBottom: OnePickSpace.sm,
  },
  providerButton: {
    height: 52,
    borderRadius: OnePickRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kakaoButton: { backgroundColor: OnePick.kakao },
  appleButton: { backgroundColor: OnePick.apple },
  kakaoText: { ...OnePickType.bodyMedium, color: OnePick.kakaoText },
  appleText: { ...OnePickType.bodyMedium, color: OnePick.appleText },
  loginError: { ...OnePickType.caption, color: OnePick.textDanger, textAlign: 'center' },
  joinCard: {
    backgroundColor: OnePick.bgAccentSubtle,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.lg,
    marginTop: OnePickSpace.xxl,
  },
  joinTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  joinText: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  joinButton: { marginTop: OnePickSpace.md },
  shareNotice: { ...OnePickType.caption, color: OnePick.textSecondary },
  shareError: { ...OnePickType.caption, color: OnePick.textDanger },
  stateArea: { marginTop: OnePickSpace.xxxl },
  pressed: { opacity: 0.72 },
});
