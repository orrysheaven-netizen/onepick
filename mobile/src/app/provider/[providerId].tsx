import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { StateCard } from '@/components/ui';
import { useBrandBranches, useBrandProfile, useProviderProfile } from '@/hooks/useProviderProfile';
import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

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
            <Text style={styles.backText}>‹</Text>
          </Pressable>

          {brandQuery.isPending ? <ActivityIndicator accessibilityLabel="브랜드 프로필 불러오는 중" style={styles.loading} color={OnePick.brand} /> : null}
          {brandQuery.isError ? <StateCard tone="danger" title="브랜드 프로필을 불러오지 못했어요"
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
                  <Text style={styles.chevron}>›</Text>
                </Pressable>)}
              </View>
            </View> : null}

            <View style={styles.menuSection}>
              <Text style={styles.sectionTitle}>지점</Text>
              {branchesQuery.isError && branchItems.length === 0
                ? <StateCard compact tone="danger" title="지점 목록을 불러오지 못했어요"
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
                      <Text style={styles.chevron}>›</Text>
                    </Pressable>)}
                  </View>
                : branchesQuery.isPending ? <ActivityIndicator accessibilityLabel="지점 목록 불러오는 중" color={OnePick.brand} />
                : <StateCard compact title="아직 원픽이 있는 지점이 없어요" />}
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        {query.isPending ? <ActivityIndicator accessibilityLabel="제공처 프로필 불러오는 중" style={styles.loading} color={OnePick.brand} /> : null}
        {query.isError ? <StateCard tone="danger" title="제공처 프로필을 불러오지 못했어요"
          text="존재하지 않거나 현재 공개되지 않는 제공처일 수 있어요."
          action={{ label: query.isFetching ? '불러오는 중…' : '다시 불러오기', disabled: query.isFetching,
            onPress: () => { if (!query.isFetching) void query.refetch(); } }} /> : null}

        {query.data ? <>
          <View style={styles.identity}>
            <View style={styles.titleRow}>
              <View style={styles.channelBadge}><Text style={styles.channelText}>{query.data.channelLabel}</Text></View>
              <Text accessibilityRole="header" style={styles.title}>{query.data.name}</Text>
            </View>
            {query.data.branchName ? <Text style={styles.branch}>{query.data.branchName}</Text> : null}
            {query.data.subtitle ? <Text style={styles.subtitle}>{query.data.subtitle}</Text> : null}
          </View>

          {query.data.link ? <View style={styles.links}>
            <Text style={styles.sectionEyebrow}>연결</Text>
            <Pressable accessibilityRole="link"
              accessibilityLabel={`${query.data.link.label}, ${query.data.link.host}, 새 창`}
              onPress={() => void openLink()}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
              <View style={styles.linkCopy}>
                <Text style={styles.linkLabel}>{query.data.link.label}</Text>
                <Text numberOfLines={1} style={styles.linkHost}>{query.data.link.host}</Text>
              </View>
              <Text style={styles.external}>↗</Text>
            </Pressable>
            {linkError ? <Text accessibilityRole="alert" style={styles.error}>링크를 열지 못했어요. 다시 시도해주세요.</Text> : null}
          </View> : null}

          <View style={styles.menuSection}>
            <Text style={styles.sectionTitle}>{query.data.kind === 'offline_branch' ? '이곳의 원픽' : '이 판매처의 원픽'}</Text>
            {query.data.items.length ? <View style={styles.menuList}>
              {query.data.items.map((item) => <Pressable key={item.itemId} accessibilityRole="button"
                accessibilityLabel={`${item.menuName}, 원픽 ${item.pickCount}, 상세 보기`}
                onPress={() => router.push({ pathname: '/item/[itemId]', params: { itemId: item.itemId } })}
                style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
                {item.thumbnailUrl ? <PickPhoto square uri={item.thumbnailUrl} label={item.menuName} itemId={item.itemId} /> : null}
                <View style={styles.menuCopy}>
                  <Text style={styles.menuName}>{item.menuName}</Text>
                  <Text style={styles.pickCount}>원픽 {item.pickCount.toLocaleString()}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>)}
            </View> : <StateCard compact title="아직 공개된 원픽이 없어요" text="이 제공처에서 메뉴 원픽이 생기면 여기에 표시돼요." />}
          </View>
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
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
  chevron: { color: OnePick.hint, fontSize: 24 },
  pressed: { opacity: 0.65 },
});
