import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { SignOutButton } from '@/components/sign-out-button';
import { AppError } from '@/errors/appError';
import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';

type MyProfileData = Awaited<ReturnType<typeof import('@/services').profileService.getMyProfile>>;
type ProfilePickItem = MyProfileData['currentPicks'][number];
type ProductRequestItem = MyProfileData['productRequests'][number];

function PickCard({ item, muted = false, onPress }: { item: ProfilePickItem; muted?: boolean; onPress: () => void }) {
  const title = item.product?.name ?? '제품 정보를 확인할 수 없어요';
  const category = item.category?.name ?? '카테고리';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.pickCard, muted && styles.pickCardMuted, pressed && styles.pressed]}>
      <PickPhoto uri={item.product?.thumbnailUrl} label={title} />
      <View style={styles.pickCopy}>
        <Text style={styles.pickCategory}>{category}</Text>
        <Text style={styles.pickName}>{title}</Text>
        <Text style={styles.pickReview}>“{item.pick.oneLineReview}”</Text>
        {muted ? (
          <Text style={styles.pickMeta}>
            {item.pick.status === 'replaced' ? '다른 원픽으로 변경됨' : '선택 종료'}
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function getRequestState(item: ProductRequestItem) {
  switch (item.product.status) {
    case 'pending':
      return { label: '승인 대기', description: '관리자가 제품 정보를 확인하고 있어요.', targetId: null };
    case 'active':
    case 'discontinued':
      return { label: '승인됨', description: '정식 제품으로 등록됐어요. 이제 원픽으로 선택할 수 있어요.', targetId: item.product.id };
    case 'merged':
      return {
        label: '기존 제품과 연결됨',
        description: item.mergedIntoProduct
          ? `${item.mergedIntoProduct.name} 제품으로 통합됐어요.`
          : '이미 등록된 정식 제품과 연결됐어요.',
        targetId: item.mergedIntoProduct?.id ?? null,
      };
    case 'rejected':
      return { label: '등록되지 않음', description: '중복이 아니거나 제품 기준에 맞지 않아 정식 등록되지 않았어요.', targetId: null };
    case 'hidden':
      return { label: '숨김', description: '현재 공개되지 않는 제품이에요.', targetId: null };
    default:
      return { label: item.product.status, description: '제품 상태를 확인해주세요.', targetId: null };
  }
}

function ProductRequestCard({ item, onOpenProduct }: { item: ProductRequestItem; onOpenProduct: (productId: string) => void }) {
  const state = getRequestState(item);
  const category = item.category?.name ?? '카테고리';
  const content = (
    <>
      <PickPhoto uri={item.product.thumbnailUrl} label={item.product.name} />
      <View style={styles.requestCopy}>
        <View style={styles.requestTopRow}>
          <Text style={styles.requestCategory}>{category}</Text>
          <View style={[styles.requestBadge, state.targetId && styles.requestBadgeDone]}>
            <Text style={[styles.requestBadgeText, state.targetId && styles.requestBadgeTextDone]}>{state.label}</Text>
          </View>
        </View>
        <Text style={styles.requestName}>{item.product.name}</Text>
        <Text style={styles.requestDescription}>{state.description}</Text>
        {state.targetId ? <Text style={styles.requestAction}>정식 제품 보기 ›</Text> : null}
      </View>
    </>
  );

  if (!state.targetId) {
    return <View style={styles.requestCard}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpenProduct(state.targetId!)}
      style={({ pressed }) => [styles.requestCard, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const profileQuery = useMyProfile(user?.id);
  const adminAccess = useAdminAccess(Boolean(user));

  const isProfileMissing =
    profileQuery.error instanceof AppError && profileQuery.error.code === 'PROFILE_NOT_FOUND';

  if (isSessionLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator />
          <Text style={styles.stateText}>프로필을 확인하고 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (sessionError) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>로그인 상태를 확인하지 못했어요</Text>
          <Text style={styles.stateText}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
          <Pressable accessibilityRole="button" onPress={retrySession} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>다시 확인하기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>1</Text></View>
          <Text style={styles.stateTitle}>나의 원픽을 모아보세요</Text>
          <Text style={styles.stateText}>로그인하면 카테고리별 현재 원픽과 이전 선택 기록을 한곳에서 볼 수 있어요.</Text>
          <Pressable onPress={() => router.push({ pathname: '/auth/login', params: { action: 'profile' } })} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>로그인하기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (isProfileMissing) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>프로필을 완성해주세요</Text>
          <Text style={styles.stateText}>원픽을 공개하려면 사용할 사용자명을 먼저 정하면 됩니다.</Text>
          <Pressable onPress={() => router.push({ pathname: '/auth/username', params: { action: 'profile' } })} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>사용자명 만들기</Text>
          </Pressable>
          <SignOutButton />
        </View>
      </SafeAreaView>
    );
  }

  if (profileQuery.isPending) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <ActivityIndicator />
          <Text style={styles.stateText}>원픽을 모으고 있어요</Text>
          <SignOutButton />
        </View>
      </SafeAreaView>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>프로필을 불러오지 못했어요</Text>
          <Pressable onPress={() => void profileQuery.refetch()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>다시 불러오기</Text>
          </Pressable>
          <SignOutButton />
        </View>
      </SafeAreaView>
    );
  }

  const { profile, currentPicks, history, productRequests } = profileQuery.data;
  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openProduct = (productId: string) => router.push({ pathname: '/product/[productId]', params: { productId } });
  const openPublicProfile = () => router.push({ pathname: '/u/[username]', params: { username: profile.username } });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{profile.username.slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>MY ONEPICK</Text>
            <Text style={styles.username}>@{profile.username}</Text>
            {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          </View>
        </View>

        <View style={styles.summaryCard}>
          <View><Text style={styles.summaryNumber}>{currentPicks.length}</Text><Text style={styles.summaryLabel}>현재 원픽</Text></View>
          <View style={styles.summaryDivider} />
          <View><Text style={styles.summaryNumber}>{history.length}</Text><Text style={styles.summaryLabel}>이전 선택</Text></View>
        </View>

        <Pressable onPress={openPublicProfile} style={({ pressed }) => [styles.publicProfileButton, pressed && styles.pressed]}>
          <View style={styles.actionCopy}>
            <Text style={styles.publicProfileTitle}>공개 프로필 보기</Text>
            <Text style={styles.publicProfileText}>다른 사람에게 보이는 현재 원픽 컬렉션을 확인하고 공유할 수 있어요.</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        {adminAccess.data === true ? (
          <Pressable onPress={() => router.push('/admin')} style={({ pressed }) => [styles.adminButton, pressed && styles.pressed]}>
            <View style={styles.actionCopy}>
              <Text style={styles.adminTitle}>관리자 데이터 관리</Text>
              <Text style={styles.adminText}>승인 대기 제품, 정식 제품, 카테고리와 브랜드를 관리합니다.</Text>
            </View>
            <Text style={styles.adminChevron}>›</Text>
          </Pressable>
        ) : null}

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>지금의 원픽</Text><Text style={styles.sectionHint}>{currentPicks.length}개</Text></View>
        {currentPicks.length > 0 ? currentPicks.map((item) => <PickCard key={item.pick.id} item={item} onPress={() => openPick(item.pick.id)} />) : (
          <View style={styles.emptyCard}><Text style={styles.emptyTitle}>아직 고른 원픽이 없어요</Text><Text style={styles.emptyText}>홈에서 지금 가장 좋아하는 하나를 골라보세요.</Text><Pressable onPress={() => router.push('/')} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryButtonText}>원픽 고르러 가기</Text></Pressable></View>
        )}

        {productRequests.length > 0 ? (
          <>
            <View style={[styles.sectionHeader, styles.requestHeader]}>
              <Text style={styles.sectionTitle}>내 제품 등록 요청</Text>
              <Text style={styles.sectionHint}>{productRequests.length}개</Text>
            </View>
            {productRequests.map((item) => (
              <ProductRequestCard key={item.product.id} item={item} onOpenProduct={openProduct} />
            ))}
          </>
        ) : null}

        <View style={[styles.sectionHeader, styles.historyHeader]}><Text style={styles.sectionTitle}>이전 원픽 기록</Text><Text style={styles.sectionHint}>{history.length}개</Text></View>
        {history.length > 0 ? history.map((item) => <PickCard key={item.pick.id} item={item} muted onPress={() => openPick(item.pick.id)} />) : <Text style={styles.noHistory}>원픽을 바꾸면 이전 선택이 여기에 차곡차곡 남습니다.</Text>}
        <SignOutButton />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 24 },
  profileAvatar: { width: 68, height: 68, borderRadius: 23, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: '#FFF9F3', fontSize: 27, fontWeight: '900' },
  headerCopy: { flex: 1, marginLeft: 16 },
  eyebrow: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  username: { color: '#202124', fontSize: 24, fontWeight: '800', marginTop: 5 },
  bio: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 6 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 18, marginBottom: 12 },
  summaryNumber: { color: '#202124', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  summaryLabel: { color: '#8E8A85', fontSize: 11, marginTop: 4, textAlign: 'center' },
  summaryDivider: { width: 1, height: 34, backgroundColor: '#EEE8E2' },
  actionCopy: { flex: 1 },
  publicProfileButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F2ECE7', borderRadius: 18, padding: 16, marginBottom: 12 },
  publicProfileTitle: { color: '#202124', fontSize: 14, fontWeight: '800' },
  publicProfileText: { color: '#8E8A85', fontSize: 11, lineHeight: 17, marginTop: 4, paddingRight: 12 },
  adminButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#252B38', borderRadius: 18, padding: 16, marginBottom: 30 },
  adminTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  adminText: { color: '#C9CDD5', fontSize: 11, lineHeight: 17, marginTop: 4, paddingRight: 12 },
  adminChevron: { color: '#FFFFFF', fontSize: 26, paddingHorizontal: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 13 },
  requestHeader: { marginTop: 28 },
  historyHeader: { marginTop: 28 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionHint: { color: '#8E8A85', fontSize: 11 },
  pickCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  pickCardMuted: { opacity: 0.7 },
  pickCopy: { flex: 1, paddingLeft: 14, paddingVertical: 3 },
  pickCategory: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  pickName: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 5 },
  pickReview: { color: '#6C6863', fontSize: 12, lineHeight: 18, marginTop: 6 },
  pickMeta: { color: '#AAA39C', fontSize: 10, marginTop: 6 },
  requestCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  requestCopy: { flex: 1, paddingLeft: 14, paddingVertical: 3 },
  requestTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  requestCategory: { flex: 1, color: '#8E8A85', fontSize: 10, fontWeight: '800' },
  requestBadge: { borderRadius: 999, backgroundColor: '#F0ECE7', paddingHorizontal: 9, paddingVertical: 5 },
  requestBadgeDone: { backgroundColor: '#F9E4DB' },
  requestBadgeText: { color: '#7D756E', fontSize: 9, fontWeight: '800' },
  requestBadgeTextDone: { color: '#D96D4B' },
  requestName: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 6 },
  requestDescription: { color: '#8E8A85', fontSize: 11, lineHeight: 17, marginTop: 5 },
  requestAction: { color: '#D96D4B', fontSize: 10, fontWeight: '800', marginTop: 7 },
  chevron: { color: '#B8B1AA', fontSize: 26, paddingHorizontal: 4 },
  emptyCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  noHistory: { color: '#8E8A85', fontSize: 12, lineHeight: 19, paddingVertical: 10 },
  centerState: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: '#202124', fontSize: 21, fontWeight: '800', marginTop: 18 },
  stateText: { color: '#8E8A85', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  primaryButton: { minHeight: 52, minWidth: 180, borderRadius: 17, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 22 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  secondaryButton: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 17 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});