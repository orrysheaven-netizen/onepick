import { type Href, Link, useGlobalSearchParams, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnePick } from '@/constants/onepick';
import { ADMIN_NAV_SECTIONS, DEFAULT_ADMIN_DATA_TAB, type AdminDataTab, type AdminNavItem } from '@/lib/admin/dataTabs';

export type AdminQueueCounts = Partial<Record<AdminDataTab, number>>;

export function AdminShell({ children, onSignOut, queueCounts = {} }: { children: ReactNode; onSignOut: () => void; queueCounts?: AdminQueueCounts }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ tab?: string }>();
  const currentTab = pathname === '/admin/data' ? params.tab ?? DEFAULT_ADMIN_DATA_TAB : null;
  const isActive = (item: AdminNavItem) => item.tab ? item.tab === currentTab : pathname === item.href || pathname.startsWith(`${item.href}/`);
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
            {ADMIN_NAV_SECTIONS.map((section) => (
              <View key={section.title ?? 'home'} style={[styles.navSection, !wide && styles.navSectionCompact]}>
                {section.title && <Text style={styles.navSectionTitle}>{section.title}</Text>}
                {section.items.map((item) => {
                  const active = isActive(item);
                  const count = item.tab ? queueCounts[item.tab] ?? 0 : 0;
                  return (
                    <Link key={item.href} href={item.href as Href} asChild>
                      <Pressable
                        accessibilityLabel={count > 0 ? `${item.label} ${count}건 대기` : item.label}
                        style={StyleSheet.flatten([styles.navItem, active && styles.navItemActive])}
                      >
                        <Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text>
                        {count > 0 && <Text style={styles.navBadge}>{count > 99 ? '99+' : count}</Text>}
                      </Pressable>
                    </Link>
                  );
                })}
              </View>
            ))}
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
  navList: { marginTop: 30, gap: 18 },
  navListCompact: { marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  navSection: { gap: 2 },
  navSectionCompact: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  navSectionTitle: { color: OnePick.hint, fontSize: 11, fontWeight: '800', paddingHorizontal: 12, marginBottom: 4 },
  navItem: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navItemActive: { backgroundColor: OnePick.sunken },
  navText: { color: OnePick.muted, fontSize: 14, fontWeight: '600' },
  navTextActive: { color: OnePick.text },
  navBadge: { minWidth: 22, textAlign: 'center', color: OnePick.onAccent, backgroundColor: OnePick.danger, borderRadius: 11, paddingHorizontal: 6, paddingVertical: 2, fontSize: 11, fontWeight: '800', overflow: 'hidden' },
  sidebarFooter: { marginTop: 'auto', gap: 14, paddingTop: 30 },
  sidebarFooterCompact: { flexDirection: 'row', marginTop: 18, paddingTop: 0 },
  backLink: { color: OnePick.muted, fontSize: 12 },
  signOut: { color: OnePick.danger, fontSize: 12, fontWeight: '700' },
  content: { flex: 1 },
  contentInner: { width: '100%', maxWidth: 1260, alignSelf: 'center', padding: 28, paddingBottom: 64 },
});
