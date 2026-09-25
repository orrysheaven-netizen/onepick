import { Link, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnePick } from '@/constants/onepick';

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: '원픽 대시보드', hint: '서비스 지표 · 추이' },
  { href: '/admin/data', label: '데이터 관리', hint: '카테고리 · 상품 · 홈 추천 · 사용자 · 신고' },
  { href: '/admin/place-catalog-qa', label: '맛집 데이터 QA', hint: 'SBIZ 서울 샘플 확인' },
  { href: '/admin/profile-taste-qa', label: '취향 QA', hint: '프로필 취향 경계 시각 확인' },
] as const;

export function AdminShell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const wide = width >= 920;

  return (
    <SafeAreaView style={styles.page}>
      <View style={[styles.shell, wide && styles.shellWide]}>
        <View style={[styles.sidebar, wide && styles.sidebarWide]}>
          <View>
            <Text style={styles.brand}>OnePick</Text>
            <Text style={styles.caption}>ADMIN</Text>
          </View>

          <View style={[styles.navList, !wide && styles.navListCompact]}>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} asChild>
                  <Pressable style={StyleSheet.flatten([styles.navItem, active && styles.navItemActive])}>
                    <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
                    {wide && <Text style={[styles.navHint, active && styles.navHintActive]}>{item.hint}</Text>}
                  </Pressable>
                </Link>
              );
            })}
          </View>

          <View style={[styles.sidebarFooter, !wide && styles.sidebarFooterCompact]}>
            <Link href="/" style={styles.backLink}>사용자 화면</Link>
            <Pressable accessibilityRole="button" onPress={onSignOut}>
              <Text style={styles.signOut}>로그아웃</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          {children}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

export const adminStyles = StyleSheet.create({
  pageTitle: { fontSize: 28, fontWeight: '800', color: OnePick.text, letterSpacing: -0.7 },
  pageDescription: { marginTop: 8, color: OnePick.muted, fontSize: 14, lineHeight: 21 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: OnePick.text },
  card: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, padding: 18 },
  muted: { color: OnePick.muted, fontSize: 13 },
  label: { color: OnePick.muted, fontSize: 12, fontWeight: '700', marginBottom: 7 },
  input: { minHeight: 42, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 9, paddingHorizontal: 12, color: OnePick.text, fontSize: 14 },
  primaryButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.text },
  primaryButtonText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '700' },
  secondaryButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  secondaryButtonText: { color: OnePick.muted, fontSize: 13, fontWeight: '700' },
  dangerButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: OnePick.dangerSoft, backgroundColor: OnePick.dangerSoft },
  dangerButtonText: { color: OnePick.danger, fontSize: 13, fontWeight: '700' },
  error: { color: OnePick.danger, fontSize: 13, lineHeight: 19 },
  success: { color: OnePick.success, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: OnePick.sunken },
  shell: { flex: 1 },
  shellWide: { flexDirection: 'row' },
  sidebar: { backgroundColor: OnePick.surface, borderBottomWidth: 1, borderBottomColor: OnePick.border, padding: 20 },
  sidebarWide: { width: 220, borderRightWidth: 1, borderRightColor: OnePick.border, borderBottomWidth: 0 },
  brand: { color: OnePick.text, fontSize: 23, fontWeight: '900', letterSpacing: -0.9 },
  caption: { marginTop: 3, color: OnePick.hint, fontSize: 10, fontWeight: '800', letterSpacing: 2.2 },
  navList: { marginTop: 34, gap: 6 },
  navListCompact: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap' },
  navItem: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 8 },
  navItemActive: { backgroundColor: OnePick.sunken },
  navText: { color: OnePick.muted, fontSize: 14, fontWeight: '600' },
  navTextActive: { color: OnePick.text },
  navHint: { marginTop: 3, color: OnePick.hint, fontSize: 11 },
  navHintActive: { color: OnePick.muted },
  sidebarFooter: { marginTop: 'auto', gap: 14, paddingTop: 30 },
  sidebarFooterCompact: { flexDirection: 'row', marginTop: 18, paddingTop: 0 },
  backLink: { color: OnePick.muted, fontSize: 12 },
  signOut: { color: OnePick.danger, fontSize: 12, fontWeight: '700' },
  content: { flex: 1 },
  contentInner: { width: '100%', maxWidth: 1260, alignSelf: 'center', padding: 28, paddingBottom: 64 },
});
