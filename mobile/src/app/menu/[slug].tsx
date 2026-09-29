import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DishPeoplePicks } from '@/components/dish-people-picks';
import { StateCard } from '@/components/ui';
import { OnePick, OnePickMvp } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCategoryBySlug } from '@/hooks/useExploreData';

const SLUG = /^[a-z0-9-]{1,64}$/;
type Params = { slug?: string | string[] };
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

export default function MenuPeoplePicksScreen() {
  const router = useRouter();
  const { user } = useAuthSession();
  const params = useLocalSearchParams<Params>();
  const rawSlug = (scalar(params.slug) ?? '').trim().toLowerCase();
  const slug = SLUG.test(rawSlug) ? rawSlug : undefined;
  const category = useCategoryBySlug(slug);
  const categoryOpen = Boolean(category.data?.status === 'open' && category.data.isVisible && category.data.isPickable);
  const name = category.data?.name;
  const notFound = !slug || (category.isSuccess && (!category.data || !categoryOpen));

  const goBack = () => router.canGoBack() ? router.back() : router.replace('/explore');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Head><title>{name ? `${name} 원픽 | OnePick` : '메뉴 원픽 | OnePick'}</title></Head>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        {category.isPending ? <ActivityIndicator accessibilityLabel="메뉴 불러오는 중" style={styles.loading} /> : null}
        {category.isError ? <StateCard compact tone="danger" title="메뉴를 불러오지 못했어요"
          action={{ label: '다시 불러오기', onPress: () => void category.refetch() }} /> : null}
        {notFound && !category.isPending ? <StateCard title="이 메뉴를 찾을 수 없어요"
          text="현재 공개된 메뉴인지 확인해주세요."
          action={{ label: '탐색으로', onPress: () => router.replace('/explore') }} /> : null}

        {categoryOpen && category.data && name ? <>
          <Text accessibilityRole="header" style={styles.title}>{name}</Text>
          <Text style={styles.subtitle}>이 메뉴를 지금 원픽으로 고른 사람들의 한줄평이에요.</Text>
          <DishPeoplePicks categoryId={category.data.id} categoryName={name} userId={user?.id} menuContext fixedChannel={OnePickMvp.publicPickChannel} />
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  loading: { marginVertical: 32 },
  title: { color: OnePick.text, fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, marginTop: 4 },
  subtitle: { color: OnePick.muted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  pressed: { opacity: 0.65 },
});
