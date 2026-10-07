import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, StateCard } from '@/components/ui';
import { useBrandBranches, useBrandProfile, useProviderProfile } from '@/hooks/useProviderProfile';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

type Params = { providerId?: string | string[]; scope?: string | string[] };
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

export default function ProviderProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const providerId = scalar(params.providerId);
  const providerScope = scalar(params.scope) === 'provider';
  const query = useProviderProfile(providerId);
  const brandId = !providerScope ? query.data?.brandId ?? undefined : undefined;
  const brandQuery = useBrandProfile(brandId);
  const branchesQuery = useBrandBranches(brandId);
  const branchItems = branchesQuery.data?.pages.flatMap((page) => page.items)
    .filter((item, index, all) => all.findIndex((other) => other.providerId === item.providerId) === index) ?? [];
  const [linkError, setLinkError] = useState(false);

  const goBack = () => router.canGoBack() ? router.back() : router.replace('/explore');
  const openLink = async () => {
    if (!query.data?.link) return;
    setLinkError(false);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(query.data.link.url, '_blank', 'noopener,noreferrer');
      } else {
        await Linking.openURL(query.data.link.url);
      }
    } catch {
      setLinkError(true);
    }
  };

  if (brandId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <Icon name="back" />
          </Pressable>

          {brandQuery.isPending ? <ActivityIndicator accessibilityLabel="브랜드 프로필 불러오는 중" style={styles.loading} color={OnePick.brand} /> : null}
          {brandQuery.isError ? <StateCard tone="danger" title="브랜드 프로필을 불러오지 못했어요."
            action={{ label: brandQuery.isFetching ? '불러오는 중…' : '다시 불러오기', disabled: brandQuery.isFetching,
              onPress: () => { if (!brandQuery.isFetching) void brandQuery.refetch(); } }} /> : null}

          {brandQuery.data ? <>
            <View style={styles.identity}>
              {brandQuery.data.logoUrl ? <Image source={{ uri: brandQuery.data.logoUrl }} style={styles.brandLogo} resizeMode="contain"
                accessibilityLabel={`${brandQuery.data.name} 로고`} /> : null}
              <Text accessibilityRole="header" style={styles.title}>{brandQuery.data.name}</Text>
              <Text style={styles.subtitle}>원픽이 있는 지점을 모아볼 수 있어요.</Text>
            </View>

            {brandQuery.data.brandWide.length > 0 ? <View style={styles.menuSection}>
              <Text style={styles.sectionTitle}>브랜드 전체</Text>
              <View style={styles.menuList}>
                {brandQuery.data.brandWide.map((item) => <Pressable key={item.itemId} accessibilityRole="button"
                  accessibilityLabel={`${item.categoryName}, 브랜드 전체 원픽 ${item.pickCount}, 상세 보기`}
                  onPress={() => router.push({ pathname: '/item/[itemId]', params: { itemId: item.itemId } })}
                  style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                  <View style={styles.menuCopy}>
                    <Text style={styles.menuName}>{item.categoryName}</Text>
                    <Text style={styles.pickCount}>원픽 {item.pickCount.toLocaleString()}</Text>
                  </View>
                  <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
                </Pressable>)}
              </View>
            </View> : null}

            <View style={styles.menuSection}>
              <Text style={styles.sectionTitle}>지점</Text>
              {branchesQuery.isError && branchItems.length === 0
                ? <StateCard compact tone="danger" title="지점 목록을 불러오지 못했어요."
                    action={{ label: '다시 불러오기', onPress: () => void branchesQuery.refetch() }} />
                : branchItems.length > 0 ? <View style={styles.menuList}>
                    {branchItems.map((branch) => <Pressable key={branch.providerId} accessibilityRole="button"
                      accessibilityLabel={`${branch.name}${branch.branchName ? ` ${branch.branchName}` : ''}, 원픽 ${branch.pickCount}, 제공처 상세 보기`}
                      onPress={() => router.push({ pathname: '/provider/[providerId]', params: { providerId: branch.providerId, scope: 'provider' } })}
                      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                      <View style={styles.menuCopy}>
                        <Text style={styles.menuName}>{branch.name}{branch.branchName ? ` · ${branch.branchName}` : ''}</Text>
                        {branch.subtitle ? <Text style={styles.subtitle}>{branch.subtitle}</Text> : null}
                        <Text style={styles.pickCount}>원픽 {branch.pickCount.toLocaleString()} · 메뉴 {branch.menuCount.toLocaleString()}</Text>
                      </View>
                      <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
                    </Pressable>)}
                  </View>
                : branchesQuery.isPending ? <ActivityIndicator accessibilityLabel="지점 목록 불러오는 중" color={OnePick.brand} />
                : <StateCard compact title="아직 원픽이 있는 지점이 없어요." />}
              {branchesQuery.hasNextPage ? <Pressable accessibilityRole="button" accessibilityLabel="브랜드 지점 더 보기"
                disabled={branchesQuery.isFetching} onPress={() => { if (!branchesQuery.isFetching) void branchesQuery.fetchNextPage(); }}
                style={({ pressed }) => [styles.more, pressed && styles.pressed]}>
                <Text style={styles.linkLabel}>{branchesQuery.isFetchingNextPage ? '불러오는 중…' : '지점 더 보기'}</Text>
              </Pressable> : null}
            </View>
          </> : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.storeHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
          style={({ pressed }) => [styles.storeHeaderSide, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.storeHeaderTitle}>{query.data?.name ?? '매장'}</Text>
        <View style={styles.storeHeaderSide} />
      </View>

      <ScrollView contentContainerStyle={styles.storeContent} showsVerticalScrollIndicator={false}>
        {query.isPending ? <ActivityIndicator accessibilityLabel="제공처 프로필 불러오는 중" style={styles.loading} color={OnePick.brand} /> : null}
        {query.isError ? <StateCard tone="danger" title="제공처 프로필을 불러오지 못했어요."
          text="존재하지 않거나 현재 공개되지 않는 제공처일 수 있어요."
          action={{ label: query.isFetching ? '불러오는 중…' : '다시 불러오기', disabled: query.isFetching,
            onPress: () => { if (!query.isFetching) void query.refetch(); } }} /> : null}

        {query.data ? <>
          <View style={styles.storeIdentity}>
            {query.data.brandLogoUrl ? (
              <View style={styles.storeLogo}>
                <Image source={{ uri: query.data.brandLogoUrl }} style={styles.storeLogoImage} resizeMode="contain"
                  accessibilityLabel={`${query.data.brandName ?? query.data.name} 로고`} />
              </View>
            ) : (
              <View accessibilityLabel="로고 미등록" style={styles.storeLogoPlaceholder}>
                <Text style={styles.storeLogoPlaceholderText}>로고{"\n"}미등록</Text>
              </View>
            )}
            <View style={styles.storeNameRow}>
              <View style={styles.storeChannelBadge}><Text style={styles.storeChannelText}>{query.data.channelLabel}</Text></View>
              <Text numberOfLines={1} style={styles.storeName}>{query.data.name}</Text>
            </View>
            {query.data.branchName || query.data.subtitle ? (
              <Text style={styles.storeLocation}>
                {[query.data.branchName, query.data.subtitle].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>

          {query.data.link ? <View style={styles.storeLinks}>
            <Text style={styles.storeLinkLabel}>연결</Text>
            <Pressable accessibilityRole="link"
              accessibilityLabel={`${query.data.link.label}, 새 창`}
              onPress={() => void openLink()}
              style={({ pressed }) => [styles.storeLinkButton, pressed && styles.pressed]}>
              <Text style={styles.storeLinkButtonText}>
                {query.data.link.label === '지도 보기' ? '지도 링크 ↗' : `${query.data.link.label} ↗`}
              </Text>
            </Pressable>
            {linkError ? <Text accessibilityRole="alert" style={styles.error}>링크를 열지 못했어요. 다시 시도해주세요.</Text> : null}
          </View> : null}

          <View style={styles.storeDivider} />
          <Text style={styles.storeSectionTitle}>{query.data.kind === 'offline_branch' ? '이곳의 원픽' : '이 판매처의 원픽'}</Text>

          {query.data.items.length ? <View style={styles.storeMenuList}>
            {query.data.items.map((item) => <Pressable key={item.itemId} accessibilityRole="button"
              accessibilityLabel={`${item.menuName}, 원픽 ${item.pickCount}, 상세 보기`}
              onPress={() => router.push({ pathname: '/item/[itemId]', params: { itemId: item.itemId } })}
              style={({ pressed }) => [styles.storeMenuRow, pressed && styles.pressed]}>
              <View style={styles.storeMenuCopy}>
                <Text numberOfLines={1} style={styles.storeMenuName}>{item.menuName}</Text>
                <Text style={styles.storePickCount}>원픽 {item.pickCount.toLocaleString()}</Text>
                {item.latestReview ? <Text numberOfLines={1} style={styles.storeReview}>“{item.latestReview}”</Text> : null}
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.storeChevron} />
            </Pressable>)}
          </View> : <StateCard compact title={query.data.kind === 'offline_branch' ? '이 매장의 첫 원픽을 골라보세요.' : '아직 공개된 원픽이 없어요.'}
            text={query.data.kind === 'offline_branch' ? '여기서 먹은 메뉴를 원픽으로 고르면 이 페이지에 모여요.' : '이 판매처에서 메뉴 원픽이 생기면 여기에 표시돼요.'}
            action={query.data.kind === 'offline_branch' ? {
              label: '이곳에서 원픽 등록하기',
              variant: 'primary',
              onPress: () => router.push({ pathname: '/pick/new', params: { providerId: query.data.id } }),
            } : undefined} />}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  storeHeader: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    backgroundColor: OnePick.bgDefault,
  },
  storeHeaderSide: { width: 48, minHeight: 44, justifyContent: 'center' },
  storeHeaderTitle: { ...OnePickType.headline, flex: 1, minWidth: 0, color: OnePick.textPrimary, textAlign: 'center' },
  storeContent: {
    width: '100%',
    maxWidth: 390,
    minHeight: 720,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingTop: OnePickSpace.sm,
    paddingBottom: OnePickSpace.xxxl,
    gap: OnePickSpace.md,
  },
  storeIdentity: { width: '100%', alignItems: 'center', gap: 7 },
  storeLogo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OnePick.bgSubtle,
  },
  storeLogoImage: { width: '100%', height: '100%' },
  storeLogoPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OnePick.bgSubtle,
  },
  storeLogoPlaceholderText: { ...OnePickType.caption, width: 56, color: OnePick.textSecondary, textAlign: 'center' },
  storeNameRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 7 },
  storeChannelBadge: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgPlaceholder,
  },
  storeChannelText: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  storeName: { ...OnePickType.title, color: OnePick.textPrimary, flexShrink: 1 },
  storeLocation: { ...OnePickType.caption, color: OnePick.muted, textAlign: 'center' },
  storeLinks: { alignItems: 'flex-start', gap: 9 },
  storeLinkLabel: { ...OnePickType.captionMedium, color: OnePick.muted },
  storeLinkButton: {
    minHeight: 41,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: OnePickRadius.md,
    borderWidth: 1,
    borderColor: OnePick.border,
    backgroundColor: OnePick.bgDefault,
  },
  storeLinkButtonText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  storeDivider: { width: '100%', height: 1, backgroundColor: OnePick.border },
  storeSectionTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  storeMenuList: { width: '100%' },
  storeMenuRow: {
    width: '100%',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.border,
  },
  storeMenuCopy: { flex: 1, minWidth: 0, minHeight: 62, justifyContent: 'center', gap: 2 },
  storeMenuName: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  storePickCount: { ...OnePickType.caption, color: OnePick.muted },
  storeReview: { ...OnePickType.caption, color: OnePick.textSecondary },
  storeChevron: { marginRight: 30  },
  loading: { marginVertical: 36 },
  identity: { alignItems: 'center', paddingVertical: 18 },
  brandLogo: { width: 72, height: 72, marginBottom: 12 },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, maxWidth: '100%' },
  channelBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: OnePickRadius.pill, backgroundColor: OnePick.accentSoft },
  channelText: { ...OnePickType.captionMedium, color: OnePick.text },
  title: { ...OnePickType.pageTitle, color: OnePick.text, flexShrink: 1 },
  branch: { ...OnePickType.bodyMedium, color: OnePick.text, marginTop: 6 },
  subtitle: { ...OnePickType.caption, color: OnePick.muted, marginTop: 4, textAlign: 'center' },
  links: { marginTop: 10 },
  sectionEyebrow: { ...OnePickType.caption, color: OnePick.muted, marginBottom: 8 },
  linkButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 15,
    borderRadius: OnePickRadius.small, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  linkCopy: { flex: 1, minWidth: 0 },
  linkLabel: { ...OnePickType.bodyMedium, color: OnePick.text },
  linkHost: { ...OnePickType.caption, color: OnePick.muted, marginTop: 2 },
  external: { color: OnePick.text, fontSize: 18, fontWeight: '700' },
  error: { ...OnePickType.caption, color: OnePick.danger, marginTop: 8 },
  menuSection: { marginTop: 28 },
  sectionTitle: { ...OnePickType.title, color: OnePick.text, marginBottom: 10 },
  menuList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: OnePick.border },
  menuRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: OnePick.border },
  menuCopy: { flex: 1, minWidth: 0 },
  menuName: { ...OnePickType.bodyMedium, color: OnePick.text },
  pickCount: { ...OnePickType.caption, color: OnePick.muted, marginTop: 3 },
  pressed: { opacity: 0.65 },
});
