import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockUserButton } from '@/components/block-user-button';
import { ProfilePickGroups } from '@/components/profile-pick-groups';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileAiComment } from '@/components/profile-ai-comment';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { ReportAction } from '@/components/report-action';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { shareProfile } from '@/lib/share/shareProfile';
import { isSeedProfileId } from '@/lib/seedProfiles';
import { OnePick } from '@/constants/onepick';

export default function PublicProfileScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username?: string }>();
  const { user } = useAuthSession();
  const query = usePublicProfile(username, user?.id);
  const categoriesQuery = useExploreCategories(Boolean(query.data));
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const isSeed = Boolean(query.data && isSeedProfileId(query.data.profile.id));

  const handleShare = async () => {
    if (!query.data || isSharing) return;
    setIsSharing(true);
    setShareError(false);
    try {
      await shareProfile({ username: query.data.profile.username, pickCount: query.data.currentPicks.length });
    } catch { setShareError(true); }
    finally { setIsSharing(false); }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backText}>‹</Text></Pressable>
        {query.isPending ? <View style={styles.stateCard}><ActivityIndicator /><Text style={styles.stateText}>프로필을 불러오고 있어요</Text></View> : null}
        {!query.isPending && (query.isError || !query.data) ? <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>프로필을 찾을 수 없어요</Text><Text style={styles.stateText}>사용자명이 바뀌었거나 존재하지 않는 프로필일 수 있어요.</Text>
        </View> : null}
        {query.data ? <>
          <View style={styles.header}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{query.data.profile.username.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.headerCopy}>
              <View style={styles.profileLabels}>
                <Text style={styles.eyebrow}>ONEPICK PROFILE</Text>
              </View>
              <Text style={styles.username}>@{query.data.profile.username}</Text>
              {query.data.profile.bio ? <Text style={styles.bio}>{query.data.profile.bio}</Text> : null}
            </View>
          </View>
          <ProfileSocialLinks profileUserId={query.data.profile.id} editable={query.data.isMine} />
          <View style={styles.summaryCard}><Text style={styles.summaryLabel}>현재 원픽</Text><Text style={styles.summaryNumber}>{query.data.currentPicks.length}개</Text></View>
          <ProfileTasteComposition profileId={query.data.profile.id} viewerId={user?.id} variant="public" />
          <ProfileAiComment
            profileId={query.data.profile.id}
            showPrivate={query.data.isMine}
            sectionTitle="AI 취향평가"
            sectionDescription="위 취향 구성은 선택의 큰 틀입니다. AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요."
          />
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>카테고리별 원픽</Text><Text style={styles.sectionHint}>{query.data.currentPicks.length}개</Text></View>
          {query.data.currentPicks.length > 0 ? (
            <ProfilePickGroups
              picks={query.data.currentPicks}
              categories={categoriesQuery.data ?? []}
              onPressPick={(pickId) => router.push({ pathname: '/pick/[pickId]', params: { pickId } })}
              onPressItem={(itemId) => router.push({ pathname: '/item/[itemId]', params: { itemId } })}
            />
          ) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>아직 공개된 원픽이 없어요</Text><Text style={styles.emptyText}>이 사용자가 원픽을 고르면 여기에 표시됩니다.</Text></View>}
          {!query.data.isMine && user && !isSeed ? <View style={styles.safetyCard}>
            <Text style={styles.safetyTitle}>사용자 관리</Text>
            <Text style={styles.safetyText}>문제가 있는 프로필은 신고하거나, 더 이상 서로의 콘텐츠를 보지 않도록 차단할 수 있습니다.</Text>
            <View style={styles.safetyActions}>
              <ReportAction reporterUserId={user.id} targetType="profile" targetId={query.data.profile.id} />
              <BlockUserButton blockerUserId={user.id} blockedUserId={query.data.profile.id} username={query.data.profile.username} onBlocked={() => router.back()} />
            </View>
          </View> : null}
          <View style={styles.shareCard}>
            <Text style={styles.shareEyebrow}>SHARE PROFILE</Text><Text style={styles.shareTitle}>이 취향 컬렉션을 공유해보세요</Text>
            <Text style={styles.shareText}>이 프로필의 원픽 컬렉션을 링크로 전해보세요.</Text>
            {shareError ? <Text style={styles.shareError}>공유 창을 열지 못했어요. 다시 시도해주세요.</Text> : null}
            <Pressable disabled={isSharing} onPress={() => void handleShare()} style={({ pressed }) => [styles.shareButton, isSharing && styles.shareButtonDisabled, pressed && styles.pressed]}>
              {isSharing ? <ActivityIndicator color={OnePick.onAccent} /> : <Text style={styles.shareButtonText}>프로필 공유하기</Text>}
            </Pressable>
          </View>
          {query.data.isMine ? <Pressable onPress={() => router.replace('/profile')} style={({ pressed }) => [styles.mineButton, pressed && styles.pressed]}><Text style={styles.mineButtonText}>내 프로필 관리로 이동</Text></Pressable> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 56 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 },
  avatar: { width: 72, height: 72, borderRadius: 24, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: OnePick.onAccent, fontSize: 28, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 16 },
  profileLabels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eyebrow: { color: OnePick.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.9 },
  username: { color: OnePick.text, fontSize: 26, fontWeight: '900', marginTop: 5 },
  bio: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 6 },
  summaryNumber: { color: OnePick.text, fontSize: 17, fontWeight: '900' },
  summaryLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  safetyCard: { backgroundColor: OnePick.sunken, borderRadius: 18, padding: 16, marginBottom: 28 },
  safetyTitle: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  safetyText: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  safetyActions: { gap: 10, marginTop: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { color: OnePick.text, fontSize: 19, fontWeight: '900' },
  sectionHint: { color: OnePick.muted, fontSize: 12 },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 24 },
  emptyTitle: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  emptyText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  shareCard: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 18, marginTop: 22 },
  shareEyebrow: { color: OnePick.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  shareTitle: { color: OnePick.text, fontSize: 16, fontWeight: '800', marginTop: 6 },
  shareText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  shareError: { color: OnePick.danger, fontSize: 12, lineHeight: 17, marginTop: 10 },
  shareButton: { minHeight: 48, borderRadius: 15, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  shareButtonDisabled: { opacity: 0.5 },
  shareButtonText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  mineButton: { minHeight: 46, borderRadius: 15, backgroundColor: OnePick.sunken, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  mineButtonText: { color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  stateCard: { alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 22, padding: 28, marginTop: 34 },
  stateTitle: { color: OnePick.text, fontSize: 18, fontWeight: '800' },
  stateText: { color: OnePick.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  pressed: { opacity: 0.72 },
});
