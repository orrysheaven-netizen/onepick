import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { ProfileAiReviewCard } from '@/components/profile-ai-review-card';
import { ProfileBioEditor } from '@/components/profile-bio-editor';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { UnselectedCategories } from '@/components/unselected-categories';
import { SignOutButton } from '@/components/sign-out-button';
import { AppError } from '@/errors/appError';
import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useMyPickHistory, useMyItemRequests } from '@/hooks/useMyProfileLists';

type MyProfileData = Awaited<ReturnType<typeof import('@/services').profileService.getMyProfile>>;
type ProfilePickItem = MyProfileData['currentPicks'][number];
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${query.isError ? '다시 불러오기' : '더 보기'}`}
          disabled={query.isFetching}
          onPress={() => {
            if (query.isFetching) return;
            if (refreshError) void query.refetch({ cancelRefetch: false });
            else void query.fetchNextPage({ cancelRefetch: false });
          }}
          style={({ pressed }) => [styles.secondaryButton, (pressed || query.isFetching) && styles.pressed]}>
          <Text style={styles.secondaryButtonText}>{query.isFetching ? '불러오는 중…' : query.isError ? '다시 불러오기' : `${label} 더 보기`}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

function PickCard({ item, muted = false, onPress }: { item: ProfilePickItem; muted?: boolean; onPress: () => void }) {
  const title = item.item?.name ?? '제품 정보를 확인할 수 없어요';
  const category = item.category?.name ?? '카테고리';
  return (
    <View style={[styles.pickCard, muted && styles.pickCardMuted]}>
      <PickPhoto uri={item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl} label={title}
        itemId={item.item?.id} itemStatus={item.item?.status} hasPhoto={Boolean(item.item?.imagePath)} />
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.pickActionArea, pressed && styles.pressed]}>
        <View style={styles.pickCopy}>
          <Text style={styles.pickCategory}>{category}</Text>
          <Text style={styles.pickName}>{title}</Text>
          <Text style={styles.pickReview}>“{item.pick.oneLineReview}”</Text>
          {muted ? <Text style={styles.pickMeta}>{item.pick.status === 'replaced' ? '다른 원픽으로 변경됨' : '선택 종료'}</Text> : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
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

  if (isSessionLoading) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <ActivityIndicator /><Text style={styles.stateText}>프로필을 확인하고 있어요</Text>
    </View></SafeAreaView>;
  }
  if (sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <Text style={styles.stateTitle}>로그인 상태를 확인하지 못했어요</Text>
      <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
      <Pressable accessibilityRole="button" onPress={retrySession} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>다시 확인하기</Text></Pressable>
    </View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>1</Text></View>
      <Text style={styles.stateTitle}>나의 원픽을 모아보세요</Text>
      <Text style={styles.stateText}>로그인하면 카테고리별 현재 원픽과 이전 선택 기록을 한곳에서 볼 수 있어요.</Text>
      <Pressable onPress={() => router.push({ pathname: '/auth/login', params: { action: 'profile' } })} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>로그인하기</Text></Pressable>
    </View></SafeAreaView>;
  }
  if (isProfileMissing) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <Text style={styles.stateTitle}>프로필을 완성해주세요</Text>
      <Text style={styles.stateText}>원픽을 공개하려면 사용할 사용자명을 먼저 정하면 됩니다.</Text>
      <Pressable onPress={() => router.push({ pathname: '/auth/username', params: { action: 'profile' } })} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}><Text style={styles.primaryButtonText}>사용자명 만들기</Text></Pressable>
      <SignOutButton />
    </View></SafeAreaView>;
  }
  if (profileQuery.isPending) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <ActivityIndicator /><Text style={styles.stateText}>원픽을 모으고 있어요</Text><SignOutButton />
    </View></SafeAreaView>;
  }
  if (!profileQuery.data) {
    return <SafeAreaView style={styles.safeArea} edges={['top']}><View style={styles.centerState}>
      <Text style={styles.stateTitle}>프로필을 불러오지 못했어요</Text>
      <Pressable onPress={() => void profileQuery.refetch()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>다시 불러오기</Text></Pressable>
      <SignOutButton />
    </View></SafeAreaView>;
  }

  const { profile, currentPicks } = profileQuery.data;
  const history = historyQuery.data ?? [];
  const itemRequests = requestsQuery.data ?? [];
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
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refreshAll} tintColor="#4945ED" />}>
        <View style={styles.header}>
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{profile.username.slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>MY ONEPICK</Text><Text style={styles.username}>@{profile.username}</Text>
          </View>
        </View>
        <ProfileBioEditor profileUserId={profile.id} bio={profile.bio} />
        <ProfileSocialLinks profileUserId={profile.id} editable />
        {profileQuery.isRefetchError ? <Text accessibilityRole="alert" style={styles.refreshError}>최신 상태를 불러오지 못했어요. 마지막으로 확인한 내용을 표시하고 있어요. 다시 새로고침해주세요.</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="프로필과 제품 등록 요청 상태 새로고침" disabled={isFetching} onPress={refreshAll}
          style={({ pressed }) => [styles.refreshButton, (pressed || isFetching) && styles.pressed]}>
          <Text style={styles.refreshText}>{isFetching ? '최신 상태 확인 중…' : '상태 새로고침'}</Text>
        </Pressable>
        <View style={styles.summaryCard}>
          <View><Text style={styles.summaryNumber}>{currentPicks.length}</Text><Text style={styles.summaryLabel}>현재 원픽</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryNumber}>{historyQuery.data ? `${history.length}${historyQuery.hasNextPage ? '+' : ''}` : '—'}</Text><Text style={styles.summaryLabel}>불러온 이전 선택</Text></View>
        </View>
        <ProfileAiReviewCard profileUserId={profile.id} pickCount={currentPicks.length} isMine />
        <Pressable onPress={openPublicProfile} style={({ pressed }) => [styles.publicProfileButton, pressed && styles.pressed]}>
          <View style={styles.actionCopy}><Text style={styles.publicProfileTitle}>공개 프로필 보기</Text><Text style={styles.publicProfileText}>다른 사람에게 보이는 현재 원픽 컬렉션을 확인하고 공유할 수 있어요.</Text></View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        {adminAccess.data === true ? <Pressable onPress={() => router.push('/admin')} style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]}>
          <View style={styles.actionCopy}><Text style={styles.adminTitle}>관리자 데이터 관리</Text><Text style={styles.adminText}>승인 대기 제품, 정식 제품, 카테고리와 브랜드를 관리합니다.</Text></View><Text style={styles.adminChevron}>›</Text>
        </Pressable> : null}
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>지금의 원픽</Text><Text style={styles.sectionHint}>{currentPicks.length}개</Text></View>
        {currentPicks.length > 0 ? currentPicks.map((item) => <PickCard key={item.pick.id} item={item} onPress={() => openPick(item.pick.id)} />) : (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>아직 고른 원픽이 없어요</Text><Text style={styles.emptyText}>홈에서 지금 가장 좋아하는 하나를 골라보세요.</Text><Pressable onPress={() => router.push('/')} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>원픽 고르러 가기</Text></Pressable></View>
        )}
        <UnselectedCategories selectedCategoryIds={currentPicks.map(({ pick }) => pick.categoryId)} />
        <View style={[styles.sectionHeader, styles.requestHeader]}>
          <Text style={styles.sectionTitle}>내 제품 등록 요청</Text>{requestsQuery.data ? <Text style={styles.sectionHint}>불러온 {itemRequests.length}개</Text> : null}
        </View>
        {itemRequests.map((item) => <ItemRequestCard key={item.item.id} item={item} onOpenItem={openItem} />)}
        {requestsQuery.data && itemRequests.length === 0 && !requestsQuery.isError ? <Text style={styles.noHistory}>아직 등록을 요청한 제품이 없어요.</Text> : null}
        <ListControls query={requestsQuery} label="등록 요청" />
        <View style={[styles.sectionHeader, styles.historyHeader]}><Text style={styles.sectionTitle}>이전 원픽 기록</Text>{historyQuery.data ? <Text style={styles.sectionHint}>불러온 {history.length}개</Text> : null}</View>
        {history.map((item) => <PickCard key={item.pick.id} item={item} muted onPress={() => openPick(item.pick.id)} />)}
        {historyQuery.data && history.length === 0 && !historyQuery.isError ? <Text style={styles.noHistory}>원픽을 바꾸면 이전 선택이 여기에 차곡차곡 남습니다.</Text> : null}
        <ListControls query={historyQuery} label="이전 기록" />
        <SignOutButton />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 24 },
  profileAvatar: { width: 68, height: 68, borderRadius: 23, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: '#FFFFFF', fontSize: 27, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 16 },
  refreshButton: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, marginBottom: 12 },
  refreshText: { color: '#4945ED', fontSize: 13, fontWeight: '800' },
  refreshError: { color: '#A9482D', fontSize: 13, lineHeight: 20, marginBottom: 8 },
  eyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  username: { color: '#202124', fontSize: 24, fontWeight: '800', marginTop: 5 },
  bio: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 6 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 18, marginBottom: 12 },
  summaryNumber: { color: '#202124', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  summaryLabel: { color: '#747985', fontSize: 12, marginTop: 4, textAlign: 'center' },
  summaryDivider: { width: 1, height: 34, backgroundColor: '#E3E5EA' },
  actionCopy: { flex: 1 },
  publicProfileButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ECEEF3', borderRadius: 18, padding: 16, marginBottom: 12 },
  publicProfileTitle: { color: '#202124', fontSize: 14, fontWeight: '800' },
  publicProfileText: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 4, paddingRight: 12 },
  adminButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#252B38', borderRadius: 18, padding: 16, marginBottom: 30 },
  adminTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  adminText: { color: '#C9CDD5', fontSize: 12, lineHeight: 17, marginTop: 4, paddingRight: 12 },
  adminChevron: { color: '#FFFFFF', fontSize: 26, paddingHorizontal: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 13 },
  requestHeader: { marginTop: 28 },
  historyHeader: { marginTop: 28 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionHint: { color: '#747985', fontSize: 12 },
  pickCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  pickCardMuted: { opacity: 0.7 },
  pickActionArea: { flex: 1, minHeight: 86, flexDirection: 'row', alignItems: 'center' },
  pickCopy: { flex: 1, paddingLeft: 14, paddingVertical: 3 },
  pickCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  pickName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  pickReview: { color: '#5F6470', fontSize: 12, lineHeight: 18, marginTop: 6 },
  pickMeta: { color: '#89909C', fontSize: 12, marginTop: 6 },
  requestCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  requestActionArea: { flex: 1, minHeight: 86, justifyContent: 'center' },
  requestCopy: { flex: 1, paddingLeft: 14, paddingVertical: 3 },
  requestTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  requestCategory: { flex: 1, color: '#747985', fontSize: 12, fontWeight: '800' },
  requestBadge: { borderRadius: 999, backgroundColor: '#ECEEF3', paddingHorizontal: 9, paddingVertical: 5 },
  requestBadgeDone: { backgroundColor: '#EFEEFF' },
  requestBadgeText: { color: '#747985', fontSize: 12, fontWeight: '800' },
  requestBadgeTextDone: { color: '#4945ED' },
  requestName: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 6 },
  requestDescription: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 5 },
  requestAction: { color: '#4945ED', fontSize: 12, fontWeight: '800', marginTop: 7 },
  chevron: { color: '#A6ADBB', fontSize: 26, paddingHorizontal: 4 },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  noHistory: { color: '#747985', fontSize: 12, lineHeight: 19, paddingVertical: 10 },
  centerState: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: '#202124', fontSize: 21, fontWeight: '800', marginTop: 18 },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  primaryButton: { minHeight: 52, minWidth: 180, borderRadius: 17, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 22 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 17 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});