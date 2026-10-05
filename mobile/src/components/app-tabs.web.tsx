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
      <View style={[styles.bar, { height: 64 + insets.bottom, paddingBottom: insets.bottom }]}>
        <TabLink href="/" icon="home" label="홈" active={isActive(pathname, '/')} />
        <TabLink href="/explore" icon="explore" label="탐색" active={isActive(pathname, '/explore')} />
        <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록" onPress={() => router.push('/pick/new')}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          <View style={[styles.icon, styles.registerIcon]}><RegisterIcon /></View>
          <Text style={[styles.label, styles.registerLabel]}>원픽 등록</Text>
        </Pressable>
        <TabLink href="/notifications" icon="notifications" label="알림" active={isActive(pathname, '/notifications')} unread={hasUnreadNotifications} />
        <TabLink href="/profile" icon="profile" label="프로필" active={isActive(pathname, '/profile')} />
      </View>
    </View>
  );
}

// Inactive tabs are tertiary outlines; the active tab is filled ink (Foundations tab bar rule).
function Icon({ name, active }: { name: TabIcon; active?: boolean }) {
  const fill = active ? OnePick.actionPrimary : 'none';
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? OnePick.actionPrimary : OnePick.textTertiary}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' ? <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" fill={fill} />
      : name === 'explore' ? <g fill={fill}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></g>
      : name === 'notifications' ? <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" fill={fill} /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>
      : <g fill={fill}><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 6 0 0 1 16 0v2Z" /></g>}
  </svg>;
}

// Register is an action, not a selectable tab: 30px ink outline circle with a drawn plus.
// Figma Add Button (287:261): 32px white circle, 1.5 ink border, bold ink plus.
function RegisterIcon() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={OnePick.actionPrimary} strokeLinecap="round" aria-hidden="true">
    <circle cx="16" cy="16" r="15.25" fill={OnePick.surface} strokeWidth="1.5" />
    <path d="M16 10.5v11M10.5 16h11" strokeWidth="2" />
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
  tabs: { flex: 1, minHeight: 0, backgroundColor: OnePick.bgDefault },
  slot: { flex: 1, minHeight: 0 },
  bar: { flexShrink: 0, flexDirection: 'row', backgroundColor: OnePick.surface, borderTopWidth: 1, borderTopColor: OnePick.border, paddingTop: 8 },
  tab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: 4 },
  icon: { width: 23, height: 23, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: 'transparent' },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: OnePick.bgAccent,
  },
  label: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  activeLabel: { color: OnePick.actionPrimary },
  // Figma 30-1 Add: the register label is always text/primary.
  registerIcon: { width: 32, height: 32 },
  registerLabel: { color: OnePick.textPrimary },
  pressed: { opacity: 0.9 },
});
