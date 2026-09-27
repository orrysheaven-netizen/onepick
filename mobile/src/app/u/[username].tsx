import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { shareProfile } from '@/lib/share/shareProfile';
import { shareProfileCardImage } from '@/lib/share/shareProfileCard';
import { isSeedProfileId } from '@/lib/seedProfiles';
import { OnePick, OnePickFeatures } from '@/constants/onepick';

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
  // v4 profiles keep the full current taste collection visible. The lab remains
  // a registration/discovery route, while ProfilePickGroups provides 음식 / 다른 취향 tabs.
  const profilePicks = query.data?.currentPicks ?? [];
  const isSeed = Boolean(query.data && isSeedProfileId(query.data.profile.id));
  const isProfileNotFound = Boolean(query.error && typeof query.error === 'object' && 'code' in query.error
    && (query.error as { code?: string }).code === 'PROFILE_NOT_FOUND');

  const handleShare = async () => {
    if (!query.data || isSharing) return;
    const { profile } = query.data;
    const currentPicks = profilePicks;
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
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
        {query.isPending ? <View style={styles.stateArea}><StateCard loading title="프로필을 불러오고 있어요" /></View> : null}
        {!query.isPending && isProfileNotFound ? <View style={styles.stateArea}>
          <StateCard title="프로필을 찾을 수 없어요" text="사용자명이 바뀌었거나 존재하지 않는 프로필일 수 있어요." />
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
              onRequireLogin={() => router.push({ pathname: '/auth/login', params: { action: 'view_profile', username: query.data!.profile.username } })} />
            <Text style={styles.followHint}>팔로우하면 홈의 팔로잉 탭에서 이 사람의 원픽과 이유를 먼저 볼 수 있어요.</Text>
          </View> : null}
          {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={query.data.profile.id} editable={query.data.isMine} /> : null}
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>현재 원픽</Text><Text style={styles.summaryNumber}>{profilePicks.length}개</Text></View>
          {OnePickFeatures.tasteComposition ? <ProfileTasteComposition profileId={query.data.profile.id} viewerId={user?.id} variant="public" /> : null}
          {OnePickFeatures.profileAi ? <ProfileAiComment
            profileId={query.data.profile.id}
            showPrivate={query.data.isMine}
            sectionTitle="AI 취향평가"
            sectionDescription="AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요."
          /> : null}
          <View style={styles.sectionHeader}><SectionHeader title="카테고리별 원픽" count={profilePicks.length} /></View>
          {profilePicks.length > 0 ? (
            <ProfilePickGroups
              picks={profilePicks}
              categories={categoriesQuery.data ?? []}
              onPressPick={(pickId) => router.push({ pathname: '/pick/[pickId]', params: { pickId } })}
              onPressItem={(itemId) => router.push({ pathname: '/item/[itemId]', params: { itemId } })}
            />
          ) : <StateCard title="아직 공개된 원픽이 없어요" text="이 사용자가 원픽을 고르면 여기에 표시됩니다." />}
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
              <BlockUserButton blockerUserId={user.id} blockedUserId={query.data.profile.id} username={query.data.profile.username} onBlocked={() => router.back()} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 },
  headerCopy: { flex: 1, marginLeft: 16 },
  username: { color: OnePick.text, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  bio: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  followRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  followHint: { flex: 1, color: OnePick.muted, fontSize: 12, lineHeight: 17 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 6 },
  summaryNumber: { color: OnePick.text, fontSize: 17, fontWeight: '900' },
  summaryLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  safetyCard: { backgroundColor: OnePick.sunken, borderRadius: 18, padding: 16, marginBottom: 28 },
  safetyTitle: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  safetyText: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  safetyActions: { gap: 10, marginTop: 12 },
  sectionHeader: { marginBottom: 10 },
  joinCard: { backgroundColor: OnePick.accentSoft, borderRadius: 20, padding: 18, marginTop: 22 },
  joinTitle: { color: OnePick.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  joinText: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 18, marginTop: 7 },
  joinButton: { marginTop: 14 },
  shareCard: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 18, marginTop: 22 },
  shareTitle: { color: OnePick.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  shareText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  shareNotice: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 17, marginTop: 10 },
  shareError: { color: OnePick.danger, fontSize: 12, lineHeight: 17, marginTop: 10 },
  shareButton: { marginTop: 14 },
  mineRow: { alignItems: 'center', marginTop: 8 },
  stateArea: { marginTop: 34 },
  pressed: { opacity: 0.72 },
});
