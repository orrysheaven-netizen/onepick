import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockUserButton } from '@/components/block-user-button';
import { PickPhoto } from '@/components/pick-photo';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { ProfileAiComment } from '@/components/profile-ai-comment';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import { ReportAction } from '@/components/report-action';
import { useAuthSession } from '@/hooks/useAuthSession';
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import { shareProfile } from '@/lib/share/shareProfile';
import { isDemoUsername } from '@/lib/demoProfile';

export default function PublicProfileScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username?: string }>();
  const { user } = useAuthSession();
  const query = usePublicProfile(username, user?.id);
  const categoryOptions = useRegistrationCategories();
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const isDemo = Boolean(query.data && isDemoUsername(query.data.profile.username));
  const categoryLabels = new Map((categoryOptions.data ?? []).map((category) => [category.id, category.label ?? category.name]));

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
                {isDemo ? <Text style={styles.demoBadge}>DEMO · 테스트 데이터</Text> : null}
              </View>
              <Text style={styles.username}>@{query.data.profile.username}</Text>
              {query.data.profile.bio ? <Text style={styles.bio}>{query.data.profile.bio}</Text> : null}
            </View>
          </View>
          <ProfileSocialLinks profileUserId={query.data.profile.id} editable={query.data.isMine} />
          <View style={styles.summaryCard}><Text style={styles.summaryNumber}>{query.data.currentPicks.length}</Text><Text style={styles.summaryLabel}>현재 원픽</Text></View>
          <ProfileTasteComposition profileId={query.data.profile.id} viewerId={user?.id} variant="public" />
          <ProfileAiComment
            profileId={query.data.profile.id}
            showPrivate={query.data.isMine}
            sectionTitle="AI 취향평가"
            sectionDescription="위 취향 구성은 선택의 큰 틀입니다. AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요."
          />
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>카테고리별 원픽</Text><Text style={styles.sectionHint}>{query.data.currentPicks.length}개</Text></View>
          {query.data.currentPicks.length > 0 ? query.data.currentPicks.map((item) => (
            <View key={item.pick.id} style={styles.pickCard}>
              <PickPhoto uri={item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl} label={item.item?.name ?? '제품 대표 이미지'}
                itemId={item.item?.id} itemStatus={item.item?.status} hasPhoto={Boolean(item.item?.imagePath)} />
              <View style={styles.pickCopy}>
                <Pressable accessibilityRole="button" accessibilityLabel="원픽 상세 보기"
                  onPress={() => router.push({ pathname: '/pick/[pickId]', params: { pickId: item.pick.id } })} style={({ pressed }) => pressed && styles.pressed}>
                  <Text style={styles.pickCategory}>{categoryLabels.get(item.pick.categoryId) ?? item.category?.name ?? '카테고리'}</Text>
                  <Text style={styles.pickName}>{item.item?.name ?? '제품 정보를 확인할 수 없어요'}</Text>
                  <Text style={styles.pickReview}>“{item.pick.oneLineReview}”</Text><Text style={styles.pickAction}>원픽 상세 보기 ›</Text>
                </Pressable>
                {item.item ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.item.name} 제품 상세 보기`}
                  onPress={() => router.push({ pathname: '/item/[itemId]', params: { itemId: item.pick.itemId } })} style={({ pressed }) => [styles.itemLink, pressed && styles.pressed]}>
                  <Text style={styles.pickAction}>제품 상세 보기 ›</Text>
                </Pressable> : null}
              </View>
            </View>
          )) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>아직 공개된 원픽이 없어요</Text><Text style={styles.emptyText}>이 사용자가 원픽을 고르면 여기에 표시됩니다.</Text></View>}
          {!query.data.isMine && user && !isDemo ? <View style={styles.safetyCard}>
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
              {isSharing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.shareButtonText}>프로필 공유하기</Text>}
            </Pressable>
          </View>
          {query.data.isMine ? <Pressable onPress={() => router.replace('/profile')} style={({ pressed }) => [styles.mineButton, pressed && styles.pressed]}><Text style={styles.mineButtonText}>내 프로필 관리로 이동</Text></Pressable> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 56 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  header: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 20 },
  avatar: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 16 },
  profileLabels: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  eyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.9 },
  demoBadge: { color: '#8A5A00', backgroundColor: '#FFF3CD', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, lineHeight: 12, fontWeight: '900' },
  username: { color: '#202124', fontSize: 26, fontWeight: '900', marginTop: 5 },
  bio: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 6 },
  summaryCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 18, marginBottom: 18 },
  summaryNumber: { color: '#202124', fontSize: 24, fontWeight: '900' },
  summaryLabel: { color: '#747985', fontSize: 12, marginTop: 4 },
  safetyCard: { backgroundColor: '#ECEEF3', borderRadius: 18, padding: 16, marginBottom: 28 },
  safetyTitle: { color: '#202124', fontSize: 13, fontWeight: '800' },
  safetyText: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 5 },
  safetyActions: { gap: 10, marginTop: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionHint: { color: '#747985', fontSize: 12 },
  pickCard: { flexDirection: 'row', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  pickCopy: { flex: 1, paddingLeft: 14, paddingVertical: 3 },
  pickCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  pickName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  pickReview: { color: '#5F6470', fontSize: 12, lineHeight: 18, marginTop: 6 },
  pickAction: { color: '#4945ED', fontSize: 12, fontWeight: '700', marginTop: 7 },
  itemLink: { minHeight: 44, justifyContent: 'center', marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E3E5EA' },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  shareCard: { borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 20, padding: 18, marginTop: 22 },
  shareEyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  shareTitle: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 6 },
  shareText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  shareError: { color: '#A9482D', fontSize: 12, lineHeight: 17, marginTop: 10 },
  shareButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  shareButtonDisabled: { opacity: 0.5 },
  shareButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  mineButton: { minHeight: 46, borderRadius: 15, backgroundColor: '#ECEEF3', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  mineButtonText: { color: '#5F5A54', fontSize: 12, fontWeight: '800' },
  stateCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 28, marginTop: 34 },
  stateTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  pressed: { opacity: 0.72 },
});
