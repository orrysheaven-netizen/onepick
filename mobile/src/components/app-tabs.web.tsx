import { Link, Slot, type Href, usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/ui/icon';
import { OnePick, OnePickIcon, OnePickLayout, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotificationCount } from '@/hooks/useNotifications';

type TabIcon = 'home' | 'explore' | 'notifications' | 'profile';

function isActive(pathname: string, href: '/' | '/explore' | '/notifications' | '/profile') {
  if (href === '/') return pathname === '/';
  if (href === '/profile') return pathname === '/profile' || pathname.startsWith('/profile/') || pathname.startsWith('/u/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Home asks for the bar to step aside while the viewer scrolls down (#762, 2026-10-12).
// AppTabs is mounted once for the tab shell; its state setter is stable, so Home reaches
// it through this module instead of a separate store.
let applyHomeTabBarHidden: ((hidden: boolean) => void) | null = null;
export function setHomeTabBarHidden(hidden: boolean) {
  applyHomeTabBarHidden?.(hidden);
}

export default function AppTabs() {
  const pathname = usePathname();
  const [homeTabBarHidden, setHomeTabBarHiddenState] = useState(false);
  applyHomeTabBarHidden = setHomeTabBarHiddenState;
  // Only Home may hide the bar; any other tab or screen always shows it.
  const barHidden = homeTabBarHidden && pathname === '/';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const notificationCount = useNotificationCount(auth.user?.id, !auth.isLoading && !auth.error && Boolean(auth.user));
  const hasUnreadNotifications = !notificationCount.isError && (notificationCount.data ?? 0) > 0;

  const safeBottom = Math.max(insets.bottom, OnePickLayout.safeAreaBottom);
  const reservedBottom = safeBottom + OnePickLayout.tabBarSafeAreaGap + OnePickLayout.tabBarHeight + OnePickLayout.tabBarContentGap;
  // Hidden = not rendered: no invisible tap area, focus stop or screen-reader entry remains.
  // Content then keeps only the safe-area inset at the bottom.

  return (
    <View style={styles.tabs}>
      <View style={[styles.slot, { paddingBottom: barHidden ? safeBottom : reservedBottom }]}><Slot /></View>
      {barHidden ? null : <View style={[styles.bar, { bottom: safeBottom + OnePickLayout.tabBarSafeAreaGap }]}>
        <TabLink href="/" icon="home" label="홈" active={isActive(pathname, '/')} />
        <TabLink href="/explore" icon="explore" label="탐색" active={isActive(pathname, '/explore')} />
        <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록" onPress={() => router.push('/pick/new')}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          <View style={[styles.icon, styles.registerIcon]}><RegisterIcon /></View>
          <Text style={[styles.label, styles.registerLabel]}>원픽 등록</Text>
        </Pressable>
        <TabLink href="/notifications" icon="notifications" label="알림" active={isActive(pathname, '/notifications')} unread={hasUnreadNotifications} />
        <TabLink href="/profile" icon="profile" label="프로필" active={isActive(pathname, '/profile')} />
      </View>}
    </View>
  );
}

// User decision: only Home uses a filled active icon; other active tabs keep outline shapes.
// Tab icons are the shared 24px (icon/size/md) UI icons; inactive icons use text/tertiary.
const TAB_ICON: Record<TabIcon, IconName> = { home: 'home', explore: 'explore', notifications: 'bell', profile: 'profile' };
function TabIconMark({ name, active }: { name: TabIcon; active?: boolean }) {
  return <Icon name={TAB_ICON[name]} size="md" color={active ? OnePick.actionPrimary : OnePick.textTertiary} filled={name === 'home' && Boolean(active)} />;
}

// Register is an action, not a selectable tab: 32px ink outline circle with a drawn plus.
// Figma Add Button (287:261): 32px white circle, 1.5 ink border; the plus is the shared
// Icon/Plus at icon/size/sm (16) centered in the circle. The 32 circle itself is unchanged.
function RegisterIcon() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke={OnePick.actionPrimary} strokeLinecap="round" aria-hidden="true">
    <circle cx="16" cy="16" r="15.25" fill={OnePick.bgDefault} strokeWidth="1.5" />
    <path d="M16 11.33v9.34M11.33 16h9.34" strokeWidth={OnePickIcon.strokeWidth} />
  </svg>;
}

function TabLink({ href, icon, label, active, unread = false }: { href: Href; icon: TabIcon; label: string; active: boolean; unread?: boolean }) {
  const [pressed, setPressed] = useState(false);
  return <Link href={href} asChild>
    <Pressable accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: active }}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={StyleSheet.flatten([styles.tab, pressed && styles.pressed])}>
      <View style={[styles.icon, active && styles.active]}><TabIconMark name={icon} active={active} />{unread ? <View accessibilityElementsHidden style={styles.unreadDot} /> : null}</View>
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </Pressable>
  </Link>;
}

const styles = StyleSheet.create({
  tabs: { flex: 1, minHeight: 0, backgroundColor: OnePick.bgDefault },
  slot: { flex: 1, minHeight: 0 },
  bar: {
    position: 'absolute',
    left: OnePickLayout.tabBarHorizontalGutter,
    right: OnePickLayout.tabBarHorizontalGutter,
    height: OnePickLayout.tabBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OnePick.bgDefault,
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    borderRadius: OnePickLayout.tabBarRadius,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  tab: { flex: 1, minWidth: 44, minHeight: OnePickLayout.tabBarContentHeight, alignItems: 'center', justifyContent: 'center', gap: 4 },
  icon: { width: 56, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
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
  // Figma 30-1 Add: the register label is always text/primary.
  registerIcon: { height: 32 },
  registerLabel: { color: OnePick.textPrimary },
  pressed: { opacity: 0.9 },
});
