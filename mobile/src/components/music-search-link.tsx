import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRegistrationCategories } from '@/hooks/useRegisterPick';
import { OnePick } from '@/constants/onepick';
import { withOnboardingParam, type OnboardingParam } from '@/lib/categories/registrationRoute';

/** Optional external lookup after local search; never blocks the primary item search. */
export function MusicSearchLink({ query, categoryId, onboarding }: { query: string; categoryId?: string; onboarding?: OnboardingParam }) {
  const router = useRouter();
  const categories = useRegistrationCategories();
  const music = !categories.isError && !categories.isPending
    ? categories.data?.find((entry) => entry.slug === 'music') : undefined;
  const text = query.trim().replace(/\s+/g, ' ');
  if (!music || (categoryId && categoryId !== music.id) || text.length < 1 || text.length > 100) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${text} 음악 DB에서 검색`}
    onPress={() => router.push({ pathname: '/pick/music', params: withOnboardingParam({ categoryId: music.id, title: text }, onboarding) })}
    style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.label}>음악 DB에서 찾아보기</Text></Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 44, justifyContent: 'center', borderRadius: 14, backgroundColor: OnePick.accentSoft, paddingHorizontal: 15, marginTop: 12 },
  label: { color: OnePick.accent, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
