import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DishPeoplePicks } from '@/components/dish-people-picks';
import { PickPhoto } from '@/components/pick-photo';
import { Button, Icon, SectionHeader, StateCard } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCategoryRanking, useRankingCategories } from '@/hooks/useExploreData';
import { homeChannelLabel } from '@/lib/home/homeChannels';
import { createRankingShareUrl } from '@/lib/share/shareLinks';
import { OnePick, OnePickMvp, OnePickThresholds } from '@/constants/onepick';

const RANKING_PAGE_SIZE = OnePickThresholds.rankingPageSize;
const SLUG = /^[a-z0-9-]{1,64}$/;

type Params = { slug?: string | string[] };
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

/**
 * Public, shareable ranking page for one leaf category (/ranking/<slug>).
 * Search engines receive the same list from the Cloudflare Function, so copy
 * and the minimum-sample rule here must match functions/ranking/[slug].ts.
 */
export default function CategoryRankingScreen() {
  const router = useRouter();
  const { user } = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const rawSlug = (scalar(params.slug) ?? '').trim().toLowerCase();
  const slug = SLUG.test(rawSlug) ? rawSlug : undefined;
  const categories = useRankingCategories(Boolean(slug), OnePickMvp.browseGroupSlug);
  const category = categories.data?.find((entry) => entry.slug === slug);
  const ranking = useCategoryRanking(slug, RANKING_PAGE_SIZE, OnePickMvp.publicPickChannel, OnePickMvp.browseGroupSlug);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  const categoryName = category?.name;
  const categoryOpen = Boolean(category);
  const rows = ranking.data ?? [];
  const topPickCount = rows.find((item) => item.rank === 1)?.pickCount ?? 0;
  // Same gate as Explore: no rank numbers until the leader has a minimum sample.
  const showRankingDetail = topPickCount >= OnePickThresholds.exploreRankingMinPicks;
  const title = categoryName ? `${categoryName} 원픽 랭킹` : '원픽 랭킹';
  const notFound = !slug || (categories.isSuccess && !category);
  const loading = Boolean(slug) && (categories.isPending || (categoryOpen && ranking.isPending));

  const goBack = () => router.canGoBack() ? router.back() : router.replace('/explore');
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });
  const choose = () => {
    if (!category) return;
    if (!user) {
      router.push({ pathname: '/auth/login', params: { action: 'register_pick', categoryId: category.categoryId } });
      return;
    }
    router.push({ pathname: '/pick/find', params: { categoryId: category.categoryId } });
  };
  const share = async () => {
    if (!slug || !categoryName) return;
    const url = createRankingShareUrl(slug);
    setShareNotice(null);
    try {
      if (Platform.OS === 'web') {
        const nav = typeof navigator !== 'undefined' ? navigator : undefined;
        if (nav?.share) { await nav.share({ title, url }); return; }
        if (nav?.clipboard) { await nav.clipboard.writeText(url); setShareNotice('랭킹 링크를 복사했어요.'); return; }
        setShareNotice(url);
        return;
      }
      await Share.share({ title, message: `${title}\n${url}`, url });
    } catch (error) {
      if (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError') return;
      setShareNotice('공유 창을 열지 못했어요. 다시 시도해주세요.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Head>
        <title>{`${title} | OnePick`}</title>
      </Head>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>

        {loading ? <ActivityIndicator accessibilityLabel="랭킹 불러오는 중" style={styles.loading} /> : null}

        {notFound && !loading ? <StateCard title="이 카테고리의 랭킹은 아직 없어요." text="카테고리가 열리면 이곳에서 원픽 랭킹을 볼 수 있어요."
          action={{ label: '카테고리 탐색으로', onPress: () => router.replace('/explore') }} /> : null}

        {categories.isError ? <StateCard compact tone="danger" title="카테고리를 불러오지 못했어요."
          action={{ label: '다시 불러오기', onPress: () => void categories.refetch() }} /> : null}

        {categoryOpen && categoryName ? <>
          <Text style={styles.eyebrow}>{category?.path ?? '원픽 랭킹'}</Text>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {showRankingDetail
              ? '지금 이걸 원픽으로 고른 사람 수 기준이에요. 한 사람은 카테고리마다 하나만 고를 수 있어요.'
              : '아직 순위를 매기기엔 원픽이 적어요. 원픽이 더 모이면 순위가 표시돼요.'}
          </Text>

          {ranking.isError ? <StateCard compact tone="danger" title="랭킹을 불러오지 못했어요."
            text={ranking.data ? '마지막으로 불러온 내용을 표시하고 있어요.' : '연결 상태를 확인한 뒤 다시 시도해주세요.'}
            action={{ label: ranking.isFetching ? '불러오는 중…' : '다시 불러오기', disabled: ranking.isFetching,
              onPress: () => { if (!ranking.isFetching) void ranking.refetch({ cancelRefetch: false }); } }} /> : null}

          <View style={styles.list}>
            {rows.map((item) => <View key={item.itemId} style={[styles.rankCard, showRankingDetail && item.rank === 1 && styles.rankCardFirst]}>
              {showRankingDetail ? <View style={styles.rankBadge}>
                {item.isTied ? <Text style={styles.rankTie}>공동</Text> : null}
                <Text style={styles.rankNumber}>{item.rank}</Text>
              </View> : null}
              <PickPhoto uri={item.thumbnailUrl} label={item.name} itemId={item.itemId} logoUri={item.brandLogoUrl} />
              <Pressable accessibilityRole="button"
                accessibilityLabel={showRankingDetail
                  ? `${item.isTied ? '공동 ' : ''}${item.rank}위 ${item.name}, ${item.pickCount}명이 선택, 상세 보기`
                  : `${item.name}, 상세 보기`}
                onPress={() => openItem(item.itemId)} style={({ pressed }) => [styles.rankAction, pressed && styles.pressed]}>
                <View style={styles.rankCopy}>
                  <Text style={styles.rankName}>{item.name}</Text>
                  {homeChannelLabel(item.channels) ? <Text style={styles.rankChannel}>{homeChannelLabel(item.channels)}</Text> : null}
                  {showRankingDetail ? <Text style={styles.rankCount}>{item.pickCount.toLocaleString()}명이 선택</Text> : null}
                </View>
                <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.arrow} />
              </Pressable>
            </View>)}
          </View>
          {ranking.isSuccess && rows.length === 0 ? <StateCard title="아직 선택된 원픽이 없어요." text="첫 원픽이 등록되면 이곳에 표시돼요." /> : null}
          {showRankingDetail && rows.length > 0 ? <Text style={styles.footnote}>같은 선택 수는 공동 순위 · 최대 {RANKING_PAGE_SIZE}개</Text> : null}

          {category && slug ? <DishPeoplePicks categoryId={category.categoryId} categoryName={categoryName} userId={user?.id}
            returnTo={`/ranking/${slug}`} fixedChannel={OnePickMvp.publicPickChannel} /> : null}

          <View style={styles.joinCard}>
            <Text style={styles.joinTitle}>{categoryName}, 당신의 원픽은 무엇인가요?</Text>
            <Text style={styles.joinText}>하나만 고르고 한줄평을 남기면 이 랭킹에 바로 반영돼요.</Text>
            <Button fullWidth style={styles.joinButton} label={user ? `${categoryName} 원픽 고르기` : '로그인하고 원픽 고르기'}
              accessibilityLabel={`${categoryName} 카테고리에서 내 원픽 고르기`} onPress={choose} />
          </View>

          <View style={styles.shareRow}>
            <SectionHeader title="이 랭킹 공유하기" description="링크를 받은 사람은 로그인 없이 볼 수 있어요."
              action={{ label: '링크 공유', accessibilityLabel: `${title} 링크 공유`, onPress: () => void share() }} />
            {shareNotice ? <Text accessibilityLiveRegion="polite" style={styles.shareNotice} selectable>{shareNotice}</Text> : null}
          </View>
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  loading: { marginVertical: 32 },
  eyebrow: { color: OnePick.muted, fontSize: 12, fontWeight: '700', marginTop: 6 },
  title: { color: OnePick.text, fontSize: 26, fontWeight: '800', lineHeight: 34, letterSpacing: -0.6, marginTop: 4 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  list: { gap: 0 },
  rankCard: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 10, borderRadius: 20, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  rankCardFirst: { borderColor: OnePick.accentSoft, backgroundColor: OnePick.accentSoft },
  rankBadge: { width: 28, alignItems: 'center', marginRight: 10 },
  rankTie: { color: OnePick.muted, fontSize: 10, fontWeight: '600' },
  rankNumber: { color: OnePick.accent, fontSize: 25, fontWeight: '800' },
  rankAction: { flex: 1, minHeight: 86, flexDirection: 'row', alignItems: 'center' },
  rankCopy: { flex: 1, paddingLeft: 12 },
  rankName: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  rankChannel: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  rankCount: { color: OnePick.accent, fontSize: 12, fontWeight: '700', marginTop: 8 },
  arrow: { marginLeft: 5  },
  footnote: { color: OnePick.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  joinCard: { backgroundColor: OnePick.accentSoft, borderRadius: 20, padding: 18, marginTop: 22 },
  joinTitle: { color: OnePick.text, fontSize: 16, lineHeight: 22, fontWeight: '800' },
  joinText: { color: OnePick.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  joinButton: { marginTop: 14 },
  shareRow: { marginTop: 28 },
  shareNotice: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  pressed: { opacity: 0.7 },
});
