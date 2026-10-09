import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecentItemCard } from '@/components/recent-item-card';
import { Icon, StateCard } from '@/components/ui';
import { OnePick, OnePickMvp, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useHomeItemRanking } from '@/hooks/useHomeData';

const POPULAR_LIMIT = 50;

/** Home 인기 메뉴 더보기 (10-05): the same 7-day store×menu ranking, in order. */
export default function PopularMenusScreen() {
  const router = useRouter();
  const ranking = useHomeItemRanking(OnePickMvp.publicPickChannel, POPULAR_LIMIT);
  const items = ranking.data ?? [];
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Icon name="back" />
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>최근 7일 원픽 많은 순</Text>
        </View>
        {ranking.isPending ? <StateCard loading title="인기 메뉴를 불러오고 있어요." /> : null}
        {ranking.isError ? <StateCard tone="danger" title="인기 메뉴를 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
          action={{ label: '다시 불러오기', disabled: ranking.isFetching, onPress: () => void ranking.refetch() }} /> : null}
        {ranking.isSuccess && !items.length ? <StateCard title="최근 7일 원픽이 아직 없어요." text="원픽이 쌓이면 많이 고른 메뉴를 보여드릴게요." /> : null}
        {items.length ? <View style={styles.grid}>
          {items.map((item) => <RecentItemCard key={item.itemId} item={item}
            onOpen={() => router.push({ pathname: '/item/[itemId]', params: { itemId: item.itemId } })} />)}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, paddingBottom: OnePickSpace.xxl },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, marginBottom: OnePickSpace.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  title: { ...OnePickType.title, color: OnePick.textPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: OnePickSpace.lg },
  pressed: { opacity: 0.65 },
});
