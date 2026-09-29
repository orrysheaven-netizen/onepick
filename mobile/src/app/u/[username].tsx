import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockUserButton } from '@/components/block-user-button';
import { FollowButton } from '@/components/follow-button';
import { ProfilePickGroups } from '@/components/profile-pick-groups';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileAiComment } from '@/components/profile-ai-comment';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { ReportAction } from '@/components/report-action';
import { Avatar, Button, SectionHeader, StateCard } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useProfileAiComment } from '@/hooks/useProfileAi';
import { useSocialSignIn } from '@/hooks/useSocialSignIn';
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { shareProfile } from '@/lib/share/shareProfile';
import { shareProfileCardImage } from '@/lib/share/shareProfileCard';
import { filterMainProfileByChannel, splitLabPicks } from '@/lib/profile/profilePickGroups';
import { getPostAuthRoute, type AuthIntent } from '@/lib/auth/authIntent';
import { armFollowProfileIntent, clearFollowProfileIntent, consumeFollowProfileIntent } from '@/lib/auth/followProfileIntent';
import { isSeedProfileId } from '@/lib/seedProfiles';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { SocialAuthProvider } from '@/types/domain/auth';

export default function PublicProfileScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username?: string }>();
  const { user } = useAuthSession();
  const query = usePublicProfile(username, user?.id);
  const categoriesQuery = useExploreCategories(Boolean(query.data));
  // Always call the hook; an absent profileId disables its network query.
  const aiCommentQuery = useProfileAiComment(OnePickFeatures.profileAi ? query.data?.profile.id : undefined);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  const [profileScope, setProfileScope] = useState<'food' | 'other'>('food');
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);
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
  const visibleProfilePicks = profileScope === 'food' ? publicMainPicks : labPicks;
  const isSeed = Boolean(query.data && isSeedProfileId(query.data.profile.id));
  const isProfileNotFound = Boolean(query.error && typeof query.error === 'object' && 'code' in query.error
    && (query.error as { code?: string }).code === 'PROFILE_NOT_FOUND');

  useEffect(() => {
    if (!followToast) return;
    const timer = setTimeout(() => setFollowToast(false), 2600);
    return () => clearTimeout(timer);
  }, [followToast]);

  const continueProfileLogin = async (provider: SocialAuthProvider) => {
    if (!query.data || socialSignIn.isPending) return;
    const targetUsername = query.data.profile.username;
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
      setLoginSheetOpen(false);
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
        {query.isPending ? <View style={styles.stateArea}><StateCard loading title="프로필을 불러오고 있어요" /></View> : null}
        {!query.isPending && isProfileNotFound ? <View style={styles.stateArea}>
          <StateCard title="프로필을 찾을 수 없어요" text="사용자명이 바뀌었거나 존재하지 않는 프로필일 수 있어요."
            action={{ label: '홈으로', variant: 'primary', onPress: () => router.replace('/') }} />
        </View> : null}
        {!query.isPending && query.isError && !isProfileNotFound ? <View style={styles.stateArea}>
          <StateCard
            tone="danger"
            title="프로필을 불러오지 못했어요"
            text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{
              label: query.isFetching ? '다시 불러오는 중…' : '다시 불러오기',
              disabled: query.isFetching,
              onPress: () => { if (!query.isFetching) void query.refetch(); },
            }}
          />
        </View> : null}
        {query.data ? <>
          <View style={styles.header}>
            <Avatar name={query.data.profile.username} size={64} />
            <View style={styles.headerCopy}>
              <Text style={styles.username}>@{query.data.profile.username}</Text>
              {query.data.profile.bio ? <Text style={styles.bio}>{query.data.profile.bio}</Text> : null}
            </View>
          </View>
          {OnePickFeatures.follow && !query.data.isMine ? <View style={styles.followRow}>
            <FollowButton
              viewerUserId={user?.id}
              profileUserId={query.data.profile.id}
              username={query.data.profile.username}
              autoFollow={autoFollow && Boolean(user)}
              onFollowed={() => setFollowToast(true)}
              onRequireLogin={() => setLoginSheetOpen(true)} />
            <Text style={styles.followHint}>팔로우하면 홈의 팔로잉 탭에서 이 사람의 원픽과 이유를 먼저 볼 수 있어요.</Text>
          </View> : null}
          {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={query.data.profile.id} editable={query.data.isMine} /> : null}
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>음식 원픽</Text><Text style={styles.summaryNumber}>{publicMainPicks.length}개</Text></View>
          {OnePickFeatures.tasteComposition ? <ProfileTasteComposition profileId={query.data.profile.id} viewerId={user?.id} variant="public" /> : null}
          {OnePickFeatures.profileAi ? <ProfileAiComment
            profileId={query.data.profile.id}
            showPrivate={query.data.isMine}
            sectionTitle="AI 취향평가"
            sectionDescription="AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요."
          /> : null}
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
          <View style={styles.sectionHeader}><SectionHeader title={profileScope === 'food' ? '음식 원픽' : '다른 취향'} count={visibleProfilePicks.length} /></View>
          {visibleProfilePicks.length > 0 ? (
            <ProfilePickGroups
              picks={visibleProfilePicks}
              categories={categoriesQuery.data ?? []}
              onPressPick={(pickId) => router.push({ pathname: '/pick/[pickId]', params: { pickId } })}
              onPressItem={(itemId) => router.push({ pathname: '/item/[itemId]', params: { itemId } })}
              onPressProvider={(providerId) => router.push({ pathname: '/provider/[providerId]', params: { providerId } })}
            />
          ) : <StateCard title={profileScope === 'food' ? '아직 공개된 음식 원픽이 없어요' : '아직 공개된 다른 취향 원픽이 없어요'}
            text={profileScope === 'food' ? '이 사용자가 음식 원픽을 고르면 여기에 표시됩니다.' : '이 사용자가 다른 취향을 고르면 여기에 표시됩니다.'} />}
          {!user ? <View style={styles.joinCard}>
            <Text style={styles.joinTitle}>나도 카테고리마다 하나씩 골라볼까요?</Text>
            <Text style={styles.joinText}>@{query.data.profile.username}님처럼 내 원픽을 모아 공개 프로필을 만들 수 있어요.{OnePickFeatures.profileAi ? ' 원픽이 충분히 쌓이면 AI 취향평가도 받을 수 있어요.' : ''}</Text>
            <Button fullWidth style={styles.joinButton} label="내 원픽 만들기"
              accessibilityLabel="로그인하고 내 원픽 만들기"
              onPress={() => router.push({ pathname: '/auth/login', params: { action: 'join_from_profile' } })} />
          </View> : null}
          {!query.data.isMine && user && !isSeed ? <View style={styles.safetyCard}>
            <Text style={styles.safetyTitle}>사용자 관리</Text>
            <Text style={styles.safetyText}>문제가 있는 프로필은 신고하거나, 더 이상 서로의 콘텐츠를 보지 않도록 차단할 수 있습니다.</Text>
            <View style={styles.safetyActions}>
              <ReportAction reporterUserId={user.id} targetType="profile" targetId={query.data.profile.id} />
              <BlockUserButton blockerUserId={user.id} blockedUserId={query.data.profile.id} username={query.data.profile.username} onBlocked={() => router.canGoBack() ? router.back() : router.replace('/')} />
            </View>
          </View> : null}
          <View style={styles.shareCard}>
            <Text style={styles.shareTitle}>이 취향 컬렉션을 공유해보세요</Text>
            <Text style={styles.shareText}>원픽이 담긴 카드 이미지와 프로필 링크를 함께 보낼 수 있어요.</Text>
            {cardNotice ? <Text style={styles.shareNotice}>{cardNotice}</Text> : null}
            {shareError ? <Text accessibilityRole="alert" style={styles.shareError}>공유 창을 열지 못했어요. 다시 시도해주세요.</Text> : null}
            <Button variant="secondary" fullWidth style={styles.shareButton} label="프로필 공유하기" loading={isSharing} onPress={() => void handleShare()} />
          </View>
          {query.data.isMine ? <View style={styles.mineRow}><Button variant="ghost" size="sm" label="내 프로필 관리로 이동" onPress={() => router.replace('/profile')} /></View> : null}
        </> : null}
      </ScrollView>
      {followToast && query.data ? <View pointerEvents="none" style={styles.toast}><Text style={styles.toastText}>@{query.data.profile.username}님을 팔로우했어요</Text></View> : null}
      <Modal visible={loginSheetOpen} transparent animationType="slide" onRequestClose={() => setLoginSheetOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="로그인 안내 닫기" onPress={() => setLoginSheetOpen(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.loginSheet}>
            <Text style={styles.loginSheetTitle}>로그인하고 @{query.data?.profile.username ?? username}님을 팔로우하세요</Text>
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
            <Button variant="ghost" size="sm" label="취소" onPress={() => setLoginSheetOpen(false)} />
          </View>
        </View>
      </Modal>
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
  backText: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: OnePickSpace.md,
    marginBottom: OnePickSpace.xl,
  },
  headerCopy: { flex: 1, marginLeft: OnePickSpace.lg },
  username: { ...OnePickType.title, color: OnePick.textPrimary },
  bio: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  followRow: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, marginBottom: OnePickSpace.lg },
  followHint: { ...OnePickType.caption, flex: 1, color: OnePick.textSecondary },
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
  safetyCard: {
    backgroundColor: OnePick.bgMuted,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.lg,
    marginBottom: OnePickSpace.xxxl,
  },
  safetyTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  safetyText: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  safetyActions: { gap: OnePickSpace.sm, marginTop: OnePickSpace.md },
  sectionHeader: { marginBottom: OnePickSpace.sm },
  profileScopeTabs: {
    flexDirection: 'row',
    gap: OnePickSpace.sm,
    marginTop: OnePickSpace.md,
    marginBottom: OnePickSpace.lg,
  },
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
  shareCard: {
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.lg,
    marginTop: OnePickSpace.xxl,
  },
  shareTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  shareText: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  shareNotice: { ...OnePickType.caption, color: OnePick.textAccent, marginTop: OnePickSpace.sm },
  shareError: { ...OnePickType.caption, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  shareButton: { marginTop: OnePickSpace.md },
  mineRow: { alignItems: 'center', marginTop: OnePickSpace.sm },
  stateArea: { marginTop: OnePickSpace.xxxl },
  pressed: { opacity: 0.72 },
});
