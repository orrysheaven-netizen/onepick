import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';

export function UnselectedCategories({ selectedCategoryIds }: { selectedCategoryIds: string[] }) {
  const router = useRouter();
  const query = useRegistrationCategories();
  const categories = query.data?.filter((category) => !selectedCategoryIds.includes(category.id)) ?? [];
  return <View style={styles.section}>
    <Text style={styles.title}>아직 선택하지 않은 카테고리</Text>
    {query.isPending ? <ActivityIndicator accessibilityLabel="카테고리 불러오는 중" /> : null}
    {query.isError ? <View>
      <Text style={styles.hint}>카테고리를 불러오지 못했어요.</Text>
      <Pressable accessibilityRole="button" disabled={query.isFetching} onPress={() => void query.refetch()} style={styles.retry}>
        <Text style={styles.action}>카테고리 다시 불러오기</Text>
      </Pressable>
    </View> : null}
    {categories.map((category) => <Pressable key={category.id} accessibilityRole="button"
      accessibilityLabel={category.name + ' 원픽 찾기'}
      onPress={() => router.push({ pathname: '/pick/find', params: { categoryId: category.id } })}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.65 }]}>
      <Text style={styles.name}>{category.label}</Text><Text style={styles.action}>원픽 고르기 ›</Text>
    </Pressable>)}
    {!query.isPending && !query.isError && !categories.length ? <Text style={styles.hint}>지금 추가로 고를 수 있는 카테고리가 없어요.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { marginTop: 26, marginBottom: 8, gap: 12 },
  title: { color: '#202124', fontSize: 18, fontWeight: '800' },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 18, padding: 18, gap: 10 },
  name: { color: '#202124', fontSize: 15, fontWeight: '700' },
  action: { color: '#4945ED', fontSize: 13, fontWeight: '700' },
  hint: { color: '#747985', fontSize: 13, lineHeight: 20 },
  retry: { minHeight: 44, justifyContent: 'center' },
});

