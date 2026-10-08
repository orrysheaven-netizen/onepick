import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, StateCard } from '@/components/ui';
import { useRankingCategories } from '@/hooks/useExploreData';
import { OnePick, OnePickMvp } from '@/constants/onepick';

/** Public index of every category ranking page; also the crawl entry point for /ranking/<slug>. */
export default function RankingIndexScreen() {
  const router = useRouter();
  const categories = useRankingCategories(true, OnePickMvp.browseGroupSlug);
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/explore');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Head><title>카테고리별 원픽 랭킹 | OnePick</title></Head>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>카테고리별 원픽 랭킹</Text>
        <Text style={styles.subtitle}>카테고리마다 하나씩만 고른 원픽을 모아, 지금 가장 많이 선택된 순서로 보여드려요.</Text>

        {categories.isPending ? <ActivityIndicator accessibilityLabel="카테고리 불러오는 중" style={styles.loading} /> : null}
        {categories.isError ? <StateCard compact tone="danger" title="카테고리를 불러오지 못했어요."
          action={{ label: '다시 불러오기', onPress: () => void categories.refetch() }} /> : null}
        {categories.data?.length === 0 ? <StateCard title="아직 공개된 랭킹이 없어요." text="카테고리가 열리면 이곳에 표시돼요." /> : null}

        <View style={styles.list}>
          {categories.data?.map((category) => <Pressable key={category.categoryId} accessibilityRole="link"
            accessibilityLabel={`${category.name} 원픽 랭킹 보기`}
            onPress={() => router.push({ pathname: '/ranking/[slug]', params: { slug: category.slug } })}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowName}>{category.name} 원픽 랭킹</Text>
              {category.path !== category.name ? <Text style={styles.rowPath}>{category.path}</Text> : null}
            </View>
            <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.arrow} />
          </Pressable>)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  title: { color: OnePick.text, fontSize: 26, fontWeight: '800', lineHeight: 34, letterSpacing: -0.6, marginTop: 6 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 18 },
  loading: { marginVertical: 32 },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  rowCopy: { flex: 1 },
  rowName: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  rowPath: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  arrow: { marginLeft: 8  },
  pressed: { opacity: 0.7 },
});
