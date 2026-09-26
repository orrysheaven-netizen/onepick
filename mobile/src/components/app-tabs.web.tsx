import { Link, Slot, type Href, usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnePick } from '@/constants/onepick';

type TabIcon = 'home' | 'explore' | 'comments' | 'profile';

function isActive(pathname: string, href: '/' | '/explore' | '/comments' | '/profile') {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.tabs}>
      <View style={styles.slot}><Slot /></View>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TabLink href="/" icon="home" label="홈" active={isActive(pathname, '/')} />
        <TabLink href="/explore" icon="explore" label="탐색" active={isActive(pathname, '/explore')} />
        <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록" onPress={() => router.push('/pick/find')}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          <View style={styles.registerIcon}><Text style={styles.plus}>＋</Text></View>
          <Text style={[styles.label, styles.activeLabel]}>원픽 등록</Text>
        </Pressable>
        <TabLink href="/comments" icon="comments" label="댓글" active={isActive(pathname, '/comments')} />
        <TabLink href="/profile" icon="profile" label="프로필" active={isActive(pathname, '/profile')} />
      </View>
    </View>
  );
}

function Icon({ name, active }: { name: TabIcon; active?: boolean }) {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? OnePick.onBrand : OnePick.muted}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' ? <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
      : name === 'explore' ? <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>
      : name === 'comments' ? <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" />
      : <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 6 0 0 1 16 0v2" /></>}
  </svg>;
}

function TabLink({ href, icon, label, active }: { href: Href; icon: TabIcon; label: string; active: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <Link href={href} asChild>
    <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={StyleSheet.flatten([styles.tab, pressed && styles.pressed])}>
      <View style={[styles.icon, active && styles.active]}><Icon name={icon} active={active} /></View>
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </Pressable>
  </Link>;
}

const styles = StyleSheet.create({
  tabs: { flex: 1, minHeight: 0, backgroundColor: OnePick.background },
  slot: { flex: 1, minHeight: 0 },
  bar: { flexShrink: 0, flexDirection: 'row', backgroundColor: OnePick.surface, borderTopWidth: 1, borderTopColor: OnePick.border, paddingTop: 8 },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 },
  icon: { width: 56, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  registerIcon: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.brand },
  plus: { color: OnePick.onBrand, fontSize: 27, lineHeight: 30, fontWeight: '400' },
  active: { backgroundColor: OnePick.brand },
  label: { fontSize: 11, fontWeight: '600', color: OnePick.muted },
  activeLabel: { color: OnePick.text, fontWeight: '800' },
  pressed: { opacity: 0.9 },
});
