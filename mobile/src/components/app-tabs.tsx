import { SymbolView } from 'expo-symbols';
import { Link, Tabs, type Href, usePathname, useRouter } from 'expo-router';
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
  return <Tabs screenOptions={{ headerShown: false }} tabBar={() => <BottomBar />} />;
}

function BottomBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuthSession();
  const notificationCount = useNotificationCount(auth.user?.id, !auth.isLoading && !auth.error && Boolean(auth.user));
  const hasUnreadNotifications = !notificationCount.isError && (notificationCount.data ?? 0) > 0;

  return (
    <View style={[styles.bar, { height: 64 + insets.bottom, paddingBottom: insets.bottom }]}>
      <TabLink href="/" icon="home" label="홈" active={isActive(pathname, '/')} />
      <TabLink href="/explore" icon="explore" label="탐색" active={isActive(pathname, '/explore')} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="원픽 등록"
        onPress={() => router.push('/pick/new')}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
        <RegisterIcon />
        <Text style={[styles.label, styles.registerLabel]}>원픽 등록</Text>
      </Pressable>
      <TabLink
        href="/notifications"
        icon="notifications"
        label="알림"
        active={isActive(pathname, '/notifications')}
        unread={hasUnreadNotifications}
      />
      <TabLink href="/profile" icon="profile" label="프로필" active={isActive(pathname, '/profile')} />
    </View>
  );
}

function NativeIcon({ name, active, unread = false }: { name: TabIcon; active: boolean; unread?: boolean }) {
  const inactiveIconColor = OnePick.textTertiary;
  const tintColor = active ? OnePick.actionPrimary : inactiveIconColor;
  const symbolName = name === 'home'
    ? ({ ios: active ? 'house.fill' : 'house', android: active ? 'home_filled' : 'home' } as const)
    : name === 'explore'
      ? ({ ios: active ? 'square.grid.2x2.fill' : 'square.grid.2x2', android: 'grid_view' } as const)
      : name === 'notifications'
        ? ({ ios: active ? 'bell.fill' : 'bell', android: active ? 'notifications' : 'notifications_none' } as const)
        : ({ ios: active ? 'person.fill' : 'person', android: active ? 'person' : 'person_outline' } as const);

  return (
    <View style={styles.icon}>
      <SymbolView name={symbolName} size={23} tintColor={tintColor} style={styles.symbol} />
      {unread ? <View accessibilityElementsHidden style={styles.unreadDot} /> : null}
    </View>
  );
}

function RegisterIcon() {
  return (
    <View style={styles.registerIcon}>
      <View style={styles.plusVertical} />
      <View style={styles.plusHorizontal} />
    </View>
  );
}

function TabLink({
  href,
  icon,
  label,
  active,
  unread = false,
}: {
  href: Href;
  icon: TabIcon;
  label: string;
  active: boolean;
  unread?: boolean;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={StyleSheet.flatten([styles.tab, pressed && styles.pressed])}>
        <NativeIcon name={icon} active={active} unread={unread} />
        <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexShrink: 0,
    backgroundColor: OnePick.surface,
    borderTopWidth: 1,
    borderTopColor: OnePick.border,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  icon: {
    width: 23,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: {
    width: 23,
    height: 23,
  },
  registerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: OnePick.actionPrimary,
    backgroundColor: OnePick.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusVertical: {
    position: 'absolute',
    width: 2,
    height: 11,
    borderRadius: 1,
    backgroundColor: OnePick.actionPrimary,
  },
  plusHorizontal: {
    position: 'absolute',
    width: 11,
    height: 2,
    borderRadius: 1,
    backgroundColor: OnePick.actionPrimary,
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: OnePick.bgAccent,
  },
  label: {
    ...OnePickType.captionMedium,
    color: OnePick.textSecondary,
  },
  activeLabel: {
    color: OnePick.actionPrimary,
  },
  registerLabel: {
    color: OnePick.textPrimary,
  },
  pressed: {
    opacity: 0.9,
  },
});
