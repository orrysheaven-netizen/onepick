import { Link, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// window.confirm only exists on web. Admin screens are currently web-only (see
// admin/_layout.tsx), but every destructive action here goes through this
// instead of calling window.confirm directly, so that gate is not the only
// thing standing between these screens and a crash on native.
export function confirmAction(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    Alert.alert('확인', message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: '확인', style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: '대시보드' },
  { href: '/admin/categories', label: '카테고리' },
  { href: '/admin/brands', label: '브랜드' },
  { href: '/admin/items', label: '상품' },
  { href: '/admin/pending', label: '검수 대기' },
  { href: '/admin/users', label: '사용자' },
  { href: '/admin/reports', label: '신고' },
  { href: '/admin/audit', label: '운영 기록' },
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
                  <Pressable style={[styles.navItem, active && styles.navItemActive]}>
                    <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
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
  pageTitle: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: -0.7 },
  pageDescription: { marginTop: 8, color: '#6B7280', fontSize: 14, lineHeight: 21 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 18 },
  muted: { color: '#6B7280', fontSize: 13 },
  label: { color: '#374151', fontSize: 12, fontWeight: '700', marginBottom: 7 },
  input: { minHeight: 42, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', borderRadius: 9, paddingHorizontal: 12, color: '#111827', fontSize: 14 },
  primaryButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  secondaryButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  secondaryButtonText: { color: '#374151', fontSize: 13, fontWeight: '700' },
  dangerButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F3C7C7', backgroundColor: '#FFF7F7' },
  dangerButtonText: { color: '#A33A3A', fontSize: 13, fontWeight: '700' },
  error: { color: '#A33A3A', fontSize: 13, lineHeight: 19 },
  success: { color: '#23633E', fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
});

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F8F9FB' },
  shell: { flex: 1 },
  shellWide: { flexDirection: 'row' },
  sidebar: { backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB', padding: 20 },
  sidebarWide: { width: 220, borderRightWidth: 1, borderRightColor: '#E5E7EB', borderBottomWidth: 0 },
  brand: { color: '#111827', fontSize: 23, fontWeight: '900', letterSpacing: -0.9 },
  caption: { marginTop: 3, color: '#9CA3AF', fontSize: 10, fontWeight: '800', letterSpacing: 2.2 },
  navList: { marginTop: 34, gap: 6 },
  navListCompact: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap' },
  navItem: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 8 },
  navItemActive: { backgroundColor: '#F3F4F6' },
  navText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  navTextActive: { color: '#111827' },
  sidebarFooter: { marginTop: 'auto', gap: 14, paddingTop: 30 },
  sidebarFooterCompact: { flexDirection: 'row', marginTop: 18, paddingTop: 0 },
  backLink: { color: '#6B7280', fontSize: 12 },
  signOut: { color: '#9B3C3C', fontSize: 12, fontWeight: '700' },
  content: { flex: 1 },
  contentInner: { width: '100%', maxWidth: 1260, alignSelf: 'center', padding: 28, paddingBottom: 64 },
});
