import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';

/** Loaded only for an empty local result; never adds a preflight to item searches. */
export function DramaSearchLink({ query, categoryId }: { query: string; categoryId?: string }) {
  const router = useRouter();
  const categories = useRegistrationCategories();
  const drama = !categories.isError && !categories.isPending
    ? categories.data?.find((entry) => entry.slug === 'drama') : undefined;
  const text = query.trim().replace(/\s+/g, ' ');
  if (!drama || (categoryId && categoryId !== drama.id) || text.length < 2 || text.length > 60) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${text} 드라마 DB에서 검색`}
    onPress={() => router.push({ pathname: '/pick/find', params: { categoryId: drama.id, query: text } })}
    style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.label}>드라마 DB에서 찾아보기</Text></Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', borderRadius: 14, backgroundColor: '#EFEEFF', paddingHorizontal: 15, marginTop: 12 },
  label: { color: '#4945ED', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
