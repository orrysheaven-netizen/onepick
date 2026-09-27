import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import { splitLabPicks } from '@/lib/profile/profilePickGroups';
import { shareProfile } from '@/lib/share/shareProfile';
import { OnePick, OnePickFeatures, OnePickMvp } from '@/constants/onepick';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const profileQuery = useMyProfile(user?.id);
  const isProfileMissing = profileQuery.error instanceof AppError && profileQuery.error.code === 'PROFILE_NOT_FOUND';
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
  const { main: mainPicks, lab: labPicks } = splitLabPicks(currentPicks, categoriesQuery.data ?? [], OnePickMvp.mainThemeCode, OnePickFeatures.lab);
  const visibleProfilePicks = profileScope === 'food' ? mainPicks : labPicks;
  const isFetching = profileQuery.isFetching;
  const isRefetching = profileQuery.isRefetching;
  const refreshAll = async () => {
    if (!isFetching) await profileQuery.refetch({ cancelRefetch: false });
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
      await shareProfile({ username: profile.username, pickCount: mainPicks.length });
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
        <View style={styles.topBar}>
          <Text style={styles.username}>{profile.username}</Text>
          <View style={styles.topActions}>
            <Button variant="ghost" size="sm" label="프로필 편집" onPress={() => router.push('/profile/edit')} />
            <Button variant="ghost" size="sm" label="설정" onPress={() => router.push('/settings')} />
          </View>
        </View>
        <View style={styles.header}>
          <Avatar name={profile.username} size={64} />
          <View style={styles.stat}>
            <Text style={styles.summaryNumber}>{currentPicks.length}</Text>
            <Text style={styles.summaryLabel}>원픽</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="내가 쓴 모든 댓글과 답글 보기"
            onPress={() => router.push('/comments')} style={({ pressed }) => [styles.stat, pressed && styles.pressed]}>
            <Text style={styles.statAction}>댓글 ›</Text>
          </Pressable>
        </View>
        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={profile.id} /> : null}
        {profileQuery.isRefetchError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 상태를 불러오지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요.</Text> : null}
        {Platform.OS === 'web' || profileQuery.isRefetchError ? <>
          <Button variant="ghost" size="sm" accessibilityLabel="프로필 새로고침" disabled={isFetching}
            onPress={refreshAll} label={isFetching ? '확인 중…' : profileQuery.isRefetchError ? '다시 불러오기' : '새로고침'} />
        </> : null}
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
              ? { label: '원픽 등록', variant: 'secondary', onPress: () => router.push('/pick/new') }
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
          {adminAccess.data === true ? <Pressable onPress={() => router.push('/admin/dashboard')} style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]}>
            <View style={styles.actionCopy}><Text style={styles.adminTitle}>관리자 데이터 관리</Text><Text style={styles.adminText}>승인 대기 제품, 정식 제품, 카테고리와 브랜드를 관리합니다.</Text></View><Text style={styles.adminChevron}>›</Text>
          </Pressable> : null}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 28 },
  topBar: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  topActions: { flexDirection: 'row', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 22, minHeight: 92, paddingTop: 10, paddingBottom: 12 },
  stat: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2 },
  statAction: { color: OnePick.text, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  refreshError: { color: OnePick.danger, fontSize: 13, lineHeight: 20, marginBottom: 8 },
  username: { color: OnePick.text, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  bio: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  summaryNumber: { color: OnePick.text, fontSize: 17, fontWeight: '900' },
  summaryLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  actionCopy: { flex: 1 },
  profileShareRow: { gap: 8, marginTop: 14, marginBottom: 14 },
  shareError: { color: OnePick.danger, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  profileScopeTabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  otherTasteEntry: { marginTop: 14 },
  profileScopeTab: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: OnePick.sunken },
  profileScopeTabSelected: { backgroundColor: OnePick.text },
  profileScopeText: { color: OnePick.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  profileScopeTextSelected: { color: OnePick.onAccent },
  managementSection: { marginTop: 30, paddingTop: 22, borderTopWidth: 1, borderTopColor: OnePick.border },
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
  chevron: { color: OnePick.hint, fontSize: 26, paddingHorizontal: 4 },
  centerState: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 20 },
  pressed: { opacity: 0.7 },
});
