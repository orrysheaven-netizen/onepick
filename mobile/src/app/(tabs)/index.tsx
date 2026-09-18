import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationButton } from '@/components/notification-button';
import { OnePickBrand } from '@/components/onepick-brand';
import { ItemSearch } from '@/components/item-search';
import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useHomeData } from '@/hooks/useHomeData';
import type { HomeFeedPick, PickReadItem } from '@/repositories/interfaces/readRepository';

function PersonPickCard({ entry, current, onOpen, onProfile, onDiscuss, onAgree, onDifferent }: {
  entry: HomeFeedPick;
  current?: PickReadItem;
  onOpen: () => void;
  onProfile: () => void;
  onDiscuss: () => void;
  onAgree: () => void;
  onDifferent: () => void;
}) {
  const same = current?.pick.status === 'active' && current.pick.itemId === entry.itemId;
  const changing = current?.pick.status === 'active' && !same;
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityLabel={`@${entry.username} 프로필 보기`}
      onPress={onProfile} style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
      {entry.profileImageUrl
        ? <Image source={{ uri: entry.profileImageUrl }} accessibilityLabel={`@${entry.username} 프로필 사진`} style={styles.personImage} />
        : <View style={styles.personAvatar}><Text style={styles.personInitial}>{entry.username.slice(0, 1).toUpperCase()}</Text></View>}
      <View style={styles.personCopy}>
        <Text style={styles.username}>@{entry.username}</Text>
        <Text style={styles.personMeta}>{entry.categoryName}에서 고른 단 하나</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
    <View style={styles.body}>
      <View style={styles.productRow}>
        <PickPhoto uri={entry.thumbnailUrl} label={entry.name} itemId={entry.itemId} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${entry.name} 제품 상세 보기`}
          onPress={onOpen} style={({ pressed }) => [styles.productCopy, pressed && styles.pressed]}>
          <Text style={styles.category}>{entry.categoryName} 원픽</Text>
          <Text style={styles.itemName}>{entry.name}</Text>
          <Text style={styles.subtle}>제품 보기 ›</Text>
        </Pressable>
      </View>
      <Text style={styles.review}>“{entry.oneLineReview}”</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`@${entry.username}의 ${entry.name} 의견 나누기`}
        onPress={onDiscuss} style={({ pressed }) => [styles.discuss, pressed && styles.pressed]}>
        <Text style={styles.actionText}>이 선택에 대해 의견 나누기 ›</Text>
      </Pressable>
      {same ? <Text style={styles.currentNotice}>같은 원픽을 골랐어요. 내 한줄평도 확인해보세요.</Text>
        : changing ? <Text style={styles.currentNotice}>현재 내 원픽: {current.item?.name ?? '다른 제품'}. 다음 화면에서 변경을 확인해요.</Text> : null}
      <View style={styles.choices}>
        <Pressable accessibilityRole="button"
          accessibilityLabel={same ? `${entry.name} 내 한줄평 보기` : `${entry.name} 나도 이게 원픽`}
          onPress={onAgree} style={({ pressed }) => [styles.agree, same && styles.already, pressed && styles.pressed]}>
          <Text style={[styles.agreeText, same && styles.alreadyText]}>{same ? '이미 내 원픽이에요' : '나도 이게 원픽'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${entry.categoryName} 나는 다른 원픽 찾기`}
          onPress={onDifferent} style={({ pressed }) => [styles.different, pressed && styles.pressed]}>
          <Text style={styles.differentText}>나는 다른 원픽</Text>
        </Pressable>
      </View>
    </View>
  </View>;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = useAuthSession();
  const homeQuery = useHomeData(user?.id, !isSessionLoading && !sessionError);
  const isLoading = isSessionLoading || (!sessionError && homeQuery.isPending);
  const data = homeQuery.data;
  const ready = !isLoading && !sessionError && Boolean(data);
  const movieCategory = data?.openCategories.find((category) => category.slug === 'movie');
  const categories = user ? data?.categoriesToPick.map(({ category }) => category) ?? [] : data?.openCategories ?? [];
  const entries = ready ? (data?.featuredPicks ?? []).filter((entry) => entry.userId !== user?.id) : [];
  const openItem = (itemId: string, pickId?: string) => router.push({ pathname: '/item/[itemId]', params: { itemId, ...(pickId ? { pickId } : {}) } });
  const findOwn = (categoryId?: string) => router.push({ pathname: '/pick/find', params: categoryId ? { categoryId } : {} });
  const currentFor = (entry: HomeFeedPick) => user
    ? data?.currentPicks.find(({ pick }) => pick.userId === user.id && pick.categoryId === entry.categoryId && pick.status === 'active')
    : undefined;
  const agree = (entry: HomeFeedPick) => {
    const current = currentFor(entry);
    if (current?.pick.itemId === entry.itemId) {
      openItem(entry.itemId, current.pick.id);
      return;
    }
    // The home action only navigates. The existing choice screen requires the
    // user's OWN reason and explicit save; it never copies another person's text.
    router.push(user
      ? { pathname: '/pick/choose', params: { itemId: entry.itemId, categoryId: entry.categoryId } }
      : { pathname: '/auth/login', params: { action: 'choose_pick', itemId: entry.itemId, categoryId: entry.categoryId } });
  };
  const refresh = () => {
    if (!isSessionLoading && !sessionError && !homeQuery.isFetching) void homeQuery.refetch({ cancelRefetch: false });
  };
  const more = () => {
    if (ready && homeQuery.hasNextPage && !homeQuery.isFetching) void homeQuery.fetchNextPage({ cancelRefetch: false });
  };

  return <SafeAreaView style={styles.safeArea} edges={['top']}>
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.pickId}
      renderItem={({ item: entry }) => <PersonPickCard entry={entry} current={currentFor(entry)}
        onOpen={() => openItem(entry.itemId)} onDiscuss={() => openItem(entry.itemId, entry.pickId)}
        onProfile={() => router.push({ pathname: '/u/[username]', params: { username: entry.username } })}
        onAgree={() => agree(entry)} onDifferent={() => findOwn(entry.categoryId)} />}
      onEndReached={() => { if (!homeQuery.isFetchNextPageError) more(); }}
      onEndReachedThreshold={0.6}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={!isSessionLoading && !sessionError ? <RefreshControl refreshing={homeQuery.isRefetching} onRefresh={refresh} tintColor={OnePick.accent} /> : undefined}
      ListHeaderComponent={<>
        <View style={styles.header}>
          <OnePickBrand />
          <View style={styles.headerActions}>
            {user && !isSessionLoading && !sessionError ? <NotificationButton userId={user.id} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="내 프로필" onPress={() => router.push('/profile')} style={styles.avatar}><Text style={styles.avatarText}>나</Text></Pressable>
          </View>
        </View>
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>서로의 취향을 만나는 곳</Text>
          <Text style={styles.headline}>다른 사람의 <Text style={styles.accent}>원픽.</Text>{'\n'}당신의 선택은요?</Text>
          <Text style={styles.description}>같은 취향이면 같은 원픽을, 다른 취향이면 나만의 원픽을 남겨보세요.</Text>
          <Text style={styles.subtle}>사진이 없는 상품에는 사진을 직접 등록해주세요.</Text>
        </View>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>사람들의 원픽</Text><Text style={styles.subtle}>최근 선택순</Text>
        </View>
        {isLoading ? <View style={styles.stateCard}><ActivityIndicator color={OnePick.accent} /><Text style={styles.stateTitle}>원픽을 불러오고 있어요</Text></View> : null}
        {sessionError || (!isSessionLoading && homeQuery.isError && !data) ? <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{sessionError ? '로그인 상태를 확인하지 못했어요' : '원픽을 불러오지 못했어요'}</Text>
          <Text style={styles.description}>연결 상태를 확인한 뒤 다시 시도해주세요.</Text>
          <Pressable accessibilityRole="button" disabled={!sessionError && homeQuery.isFetching} onPress={sessionError ? retrySession : refresh} style={styles.textButton}><Text style={styles.actionText}>다시 불러오기</Text></Pressable>
        </View> : null}
        {ready ? <>
          {homeQuery.isError && !homeQuery.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.error}>최신 원픽을 확인하지 못했어요. 마지막으로 불러온 내용을 표시하고 있어요.</Text> : null}
          <View style={styles.refreshRow}><Pressable accessibilityRole="button" accessibilityLabel="홈 원픽 새로고침" disabled={homeQuery.isFetching}
            onPress={refresh} style={({ pressed }) => [styles.textButton, (pressed || homeQuery.isFetching) && styles.pressed]}>
            <Text style={styles.actionText}>{homeQuery.isFetching ? '새로고침 중…' : homeQuery.isError ? '다시 불러오기' : '새로고침'}</Text>
          </Pressable></View>
          {!entries.length ? <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>아직 둘러볼 다른 사람의 원픽이 없어요</Text>
            <Text style={styles.description}>먼저 나만의 원픽을 남겨보세요. 다른 사람이 선택을 등록하면 이곳에서 만날 수 있어요.</Text>
            <Pressable accessibilityRole="button" onPress={() => findOwn()} style={styles.textButton}><Text style={styles.actionText}>나만의 원픽 찾기</Text></Pressable>
          </View> : null}
        </> : null}
      </>}
      ListFooterComponent={ready && data ? <>
        {homeQuery.isFetchingNextPage ? <ActivityIndicator style={styles.pageLoading} accessibilityLabel="다음 원픽 불러오는 중" color={OnePick.accent} /> : null}
        {homeQuery.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.error}>다음 원픽을 불러오지 못했어요.</Text> : null}
        {homeQuery.hasNextPage ? <Pressable accessibilityRole="button" disabled={homeQuery.isFetching} onPress={more} style={styles.textButton}>
          <Text style={styles.actionText}>{homeQuery.isFetchNextPageError ? '다음 원픽 다시 불러오기' : '원픽 더 보기'}</Text>
        </Pressable> : entries.length ? <Text style={styles.endText}>지금 볼 수 있는 원픽을 모두 확인했어요.</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="원픽 더 둘러보기" onPress={() => router.push('/explore')} style={styles.textButton}><Text style={styles.actionText}>카테고리에서 더 둘러보기 ↗</Text></Pressable>
        {user ? <Pressable accessibilityRole="button" accessibilityLabel={`내 원픽 ${data.currentPicks.length}개 모아보기`} onPress={() => router.push('/profile')} style={styles.collection}>
          <Text style={styles.actionText}>내 원픽 {data.currentPicks.length}개 모아보기 ↗</Text>
        </Pressable> : <View style={styles.collection}>
          <Text style={styles.stateTitle}>둘러보기는 로그인 없이도 가능해요</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/auth/login', params: { action: 'home' } })} style={styles.textButton}><Text style={styles.actionText}>로그인하고 내 취향 남기기</Text></Pressable>
        </View>}
        <Text style={[styles.sectionTitle, styles.nextSection]}>{user ? '아직 선택하지 않은 카테고리' : '어떤 취향부터 골라볼까요?'}</Text>
        {categories.length ? <View style={styles.categoryGrid}>{categories.map((category) => <Pressable key={category.id} accessibilityRole="button"
          accessibilityLabel={`${category.name} 원픽 찾기`} onPress={() => findOwn(category.id)} style={({ pressed }) => [styles.categoryCard, pressed && styles.pressed]}>
          <Text style={styles.categoryName}>{category.name}</Text><Text style={styles.subtle}>나만의 원픽 고르기 ↗</Text>
        </Pressable>)}</View> : <Text style={styles.description}>{user ? '지금 추가로 고를 수 있는 카테고리가 없어요.' : '새로운 카테고리를 준비하고 있어요.'}</Text>}
        <Text style={[styles.sectionTitle, styles.nextSection]}>상품 바로 찾기</Text>
        <ItemSearch compact onSearchMovie={movieCategory ? (query) => router.push({ pathname: '/pick/find', params: { categoryId: movieCategory.id, query } }) : undefined} onSelect={openItem} />
        <Text style={styles.endText}>취향이 달라도 괜찮아요. 선택의 이유를 나눠보세요.</Text>
      </> : null}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 72 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EAECF1', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, color: OnePick.text, fontWeight: '600' },
  intro: { paddingTop: 8, paddingBottom: 24 },
  eyebrow: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  headline: { color: OnePick.text, fontSize: 29, lineHeight: 39, letterSpacing: -1.1, fontWeight: '800', marginTop: 8 },
  accent: { color: OnePick.accent },
  description: { color: OnePick.muted, fontSize: 13, lineHeight: 21, marginTop: 9 },
  subtle: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: OnePick.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.6 },
  card: { overflow: 'hidden', backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, marginBottom: 16 },
  personRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: OnePick.border },
  personImage: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EAECF1' },
  personAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  personInitial: { color: OnePick.accent, fontSize: 16, fontWeight: '800' },
  personCopy: { flex: 1, minWidth: 0 },
  username: { color: OnePick.text, fontSize: 15, fontWeight: '700' },
  personMeta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  chevron: { color: OnePick.muted, fontSize: 24 },
  body: { padding: 16 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  productCopy: { flex: 1, minWidth: 0, minHeight: 86, justifyContent: 'center' },
  category: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  itemName: { color: OnePick.text, fontSize: 19, lineHeight: 26, fontWeight: '800', marginTop: 5 },
  review: { color: OnePick.text, fontSize: 15, lineHeight: 24, marginTop: 16 },
  discuss: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { color: OnePick.accent, fontSize: 13, lineHeight: 20, fontWeight: '700' },
  currentNotice: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  agree: { flexGrow: 1, flexBasis: 125, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: OnePick.accent },
  agreeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  already: { backgroundColor: OnePick.accentSoft },
  alreadyText: { color: OnePick.accent },
  different: { flexGrow: 1, flexBasis: 125, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: OnePick.border },
  differentText: { color: OnePick.text, fontSize: 13, lineHeight: 20, fontWeight: '700', textAlign: 'center' },
  stateCard: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 24, marginVertical: 12 },
  stateTitle: { color: OnePick.text, fontSize: 15, lineHeight: 23, fontWeight: '700' },
  textButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8, marginVertical: 4 },
  refreshRow: { alignItems: 'flex-end' },
  error: { color: '#A9482D', fontSize: 13, lineHeight: 20, marginVertical: 8 },
  pageLoading: { padding: 20 },
  endText: { color: OnePick.muted, textAlign: 'center', paddingVertical: 22, fontSize: 12, lineHeight: 20 },
  collection: { minHeight: 56, justifyContent: 'center', padding: 16, marginTop: 16, borderRadius: 16, backgroundColor: OnePick.accentSoft },
  nextSection: { marginTop: 26, marginBottom: 14 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  categoryCard: { width: '46%', flexGrow: 1, minHeight: 88, padding: 16, borderWidth: 1, borderColor: OnePick.border, borderRadius: 18, backgroundColor: OnePick.surface },
  categoryName: { color: OnePick.text, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
