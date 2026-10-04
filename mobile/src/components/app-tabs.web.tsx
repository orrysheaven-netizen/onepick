import { Link, Slot, type Href, usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnePick, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotificationCount } from '@/hooks/useNotifications';

type TabIcon = 'home' | 'explore' | 'notifications' | 'profile';

function isActive(pathname: string, href: '/' | '/explore' | '/notifications' | '/profile') {
  if (href === '/') return pathname === '/';
  if (href === '/profile') return pathname === '/profile' || pathname.startsWith('/profile/') || pathname.startsWith('/u/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const notificationCount = useNotificationCount(auth.user?.id, !auth.isLoading && !auth.error && Boolean(auth.user));
  const hasUnreadNotifications = !notificationCount.isError && (notificationCount.data ?? 0) > 0;

  return (
    <View style={styles.tabs}>
      <View style={styles.slot}><Slot /></View>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TabLink href="/" icon="home" label="홈" active={isActive(pathname, '/')} />
        <TabLink href="/explore" icon="explore" label="탐색" active={isActive(pathname, '/explore')} />
        <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록" onPress={() => router.push('/pick/new')}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          <View style={styles.registerIcon}><Text style={styles.plus}>+</Text></View>
          <Text style={[styles.label, styles.activeLabel]}>원픽 등록</Text>
        </Pressable>
        <TabLink href="/notifications" icon="notifications" label="알림" active={isActive(pathname, '/notifications')} unread={hasUnreadNotifications} />
        <TabLink href="/profile" icon="profile" label="프로필" active={isActive(pathname, '/profile')} />
      </View>
    </View>
  );
}

function Icon({ name, active }: { name: TabIcon; active?: boolean }) {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? OnePick.actionPrimary : OnePick.textTertiary}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' ? <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" fill={active ? OnePick.actionPrimary : 'none'} />
      : name === 'explore' ? <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>
      : name === 'notifications' ? <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      : <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 6 0 0 1 16 0v2" /></>}
  </svg>;
}

function TabLink({ href, icon, label, active, unread = false }: { href: Href; icon: TabIcon; label: string; active: boolean; unread?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <Link href={href} asChild>
    <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={StyleSheet.flatten([styles.tab, pressed && styles.pressed])}>
      <View style={[styles.icon, active && styles.active]}><Icon name={icon} active={active} />{unread ? <View accessibilityElementsHidden style={styles.unreadDot} /> : null}</View>
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
  // Figma 30-1: white circle with a dark outline and a black plus.
  registerIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.8, borderColor: OnePick.actionPrimary, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.surface },
  plus: { color: OnePick.actionPrimary, fontSize: 20, lineHeight: 22, fontWeight: '500' },
  active: { backgroundColor: 'transparent' },
  unreadDot: {
    position: 'absolute',
    top: 3,
    right: 12,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: OnePick.bgAccent,
  },
  label: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  activeLabel: { color: OnePick.actionPrimary },
  pressed: { opacity: 0.9 },
});
