import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfilePickGroups } from '@/components/profile-pick-groups';
import { Chip, Icon, SectionHeader, StateCard } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useExploreCategories } from '@/hooks/useExploreData';
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { registrationRoute } from '@/lib/categories/registrationRoute';
import { isLabCategory, splitLabPicks } from '@/lib/profile/profilePickGroups';
import { OnePick, OnePickFeatures, OnePickMvp } from '@/constants/onepick';

/** 실험실: a profile's Picks outside the main (restaurant) theme, kept out of the main flows during the MVP. */
export default function LabScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username?: string }>();
  const { user } = useAuthSession();
  const query = usePublicProfile(username, user?.id);
  const categoriesQuery = useExploreCategories(Boolean(query.data));
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const isMine = Boolean(query.data?.isMine);

  const labPicks = useMemo(
    () => splitLabPicks(query.data?.currentPicks ?? [], categories, OnePickMvp.mainThemeCode, true).lab,
    [query.data?.currentPicks, categories],
  );
  // Owner only: lab categories under a parent with no lab Pick yet.
  const startable = useMemo(() => {
    if (!isMine) return [];
    const pickedIds = new Set((query.data?.currentPicks ?? []).map((item) => item.pick.categoryId));
    const pickedParents = new Set(labPicks.map((item) => item.category?.parentId ?? item.pick.categoryId));
    return categories
      .filter((category) => category.isPickable && category.status === 'open' && category.isVisible)
      .filter((category) => isLabCategory(category.id, categories, OnePickMvp.mainThemeCode, true))
      .filter((category) => !pickedIds.has(category.id) && !pickedParents.has(category.parentId ?? category.id))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [categories, isMine, labPicks, query.data?.currentPicks]);

  const openPick = (pickId: string) => router.push({ pathname: '/pick/[pickId]', params: { pickId } });
  const openItem = (itemId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId } });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Icon name="back" />
        </Pressable>
        <Text style={styles.eyebrow}>LAB</Text>
        <Text style={styles.title}>실험실</Text>
        <Text style={styles.description}>
          원픽은 지금 맛집에 집중하고 있어요. 콘텐츠·테크·스타일 같은 다른 취향은 여기에 모아두고 계속 실험해요.
        </Text>

        {!OnePickFeatures.lab ? <View style={styles.stateArea}><StateCard title="실험실이 닫혀 있어요." text="모든 원픽은 프로필에서 볼 수 있어요." /></View> : null}
        {OnePickFeatures.lab && query.isPending ? <View style={styles.stateArea}><StateCard loading title="실험실을 불러오고 있어요." /></View> : null}
        {OnePickFeatures.lab && !query.isPending && query.isError ? <View style={styles.stateArea}>
          <StateCard tone="danger" title="실험실을 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
            action={{ label: query.isFetching ? '다시 불러오는 중…' : '다시 불러오기', disabled: query.isFetching, onPress: () => { if (!query.isFetching) void query.refetch(); } }} />
        </View> : null}

        {OnePickFeatures.lab && query.data ? <>
          <View style={styles.sectionHeader}>
            <SectionHeader title={isMine ? '내 실험실 원픽' : `@${query.data.profile.username}의 실험실 원픽`} count={labPicks.length} />
          </View>
          {categoriesQuery.isPending ? <StateCard loading title="카테고리를 확인하고 있어요." /> : labPicks.length > 0 ? (
            <ProfilePickGroups
              picks={labPicks}
              categories={categories}
              onPressPick={openPick}
              onPressItem={openItem}
            />
          ) : (
            <StateCard title="아직 실험실 원픽이 없어요." text={isMine ? '아래 카테고리에서 하나씩 골라볼 수 있어요.' : '이 사용자가 맛집 외 취향을 고르면 여기에 보여요.'} />
          )}

          {startable.length > 0 ? <View style={styles.startArea}>
            <Text style={styles.startTitle}>실험실에서 고를 수 있는 카테고리</Text>
            <View style={styles.chips}>
              {startable.map((category) => (
                <Chip key={category.id} label={category.name} dashed accessibilityLabel={`${category.name} 원픽 고르기`}
                  onPress={() => router.push(registrationRoute(category))} />
              ))}
            </View>
          </View> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 56 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  eyebrow: { color: OnePick.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginTop: 8 },
  title: { color: OnePick.text, fontSize: 24, lineHeight: 30, fontWeight: '900', letterSpacing: -0.5, marginTop: 2 },
  description: { color: OnePick.muted, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 22 },
  sectionHeader: { marginBottom: 10 },
  startArea: { marginTop: 26 },
  startTitle: { color: OnePick.text, fontSize: 14, lineHeight: 20, fontWeight: '800', marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stateArea: { marginTop: 24 },
  pressed: { opacity: 0.72 },
});
