import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DishPeoplePicks } from '@/components/dish-people-picks';
import { Button, Icon, StateCard } from '@/components/ui';
import { OnePick, OnePickMvp, OnePickSpace, OnePickType } from '@/constants/onepick';
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
  const categoryId = categoryOpen ? category.data?.id : undefined;
  const name = category.data?.name;
  const notFound = !slug || (category.isSuccess && (!category.data || !categoryOpen));

  const goBack = () => router.canGoBack() ? router.back() : router.replace('/explore');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <Head><title>{name ? `${name} 원픽 | OnePick` : '메뉴 원픽 | OnePick'}</title></Head>

      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack}
          style={({ pressed }) => [styles.headerSide, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{name ?? '메뉴'}</Text>
        <View style={styles.headerSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {category.isPending ? <ActivityIndicator accessibilityLabel="메뉴 불러오는 중" style={styles.loading} /> : null}
        {category.isError ? <StateCard compact tone="danger" title="메뉴를 불러오지 못했어요."
          action={{ label: '다시 불러오기', onPress: () => void category.refetch() }} /> : null}
        {notFound && !category.isPending ? <StateCard title="이 메뉴를 찾을 수 없어요."
          text="현재 공개된 메뉴인지 확인해주세요."
          action={{ label: '탐색으로', onPress: () => router.replace('/explore') }} /> : null}

        {categoryId && name ? (
          <DishPeoplePicks categoryId={categoryId} categoryName={name} userId={user?.id}
            returnTo={`/menu/${slug}`} fixedChannel={OnePickMvp.publicPickChannel} variant="menuDetail" />
        ) : null}
      </ScrollView>
      {categoryId && name ? <View style={styles.registerFooter}>
        <Button fullWidth label={`내 ${name} 원픽 등록하기`}
          onPress={() => router.push({
            pathname: '/pick/new',
            params: { menuName: name, categoryId },
          })} />
      </View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    backgroundColor: OnePick.bgDefault,
  },
  headerSide: { width: 48, minHeight: 44, justifyContent: 'center' },
  headerTitle: { ...OnePickType.headline, flex: 1, color: OnePick.textPrimary, textAlign: 'center' },
  content: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
    minHeight: 720,
    paddingHorizontal: OnePickSpace.gutter,
    paddingTop: OnePickSpace.sm,
    paddingBottom: OnePickSpace.xxxl,
  },
  loading: { marginVertical: OnePickSpace.xxxl },
  registerFooter: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingTop: OnePickSpace.sm,
    paddingBottom: OnePickSpace.sm,
    backgroundColor: OnePick.bgDefault,
  },
  pressed: { opacity: 0.65 },
});
