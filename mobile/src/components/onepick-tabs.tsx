import { Tabs, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotificationCount } from '@/hooks/useNotifications';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const destinations = [
  { name: 'index', label: '홈' },
  { name: 'explore', label: '탐색' },
  { name: 'register', label: '원픽 등록' },
  { name: 'notifications', label: '알림' },
  { name: 'profile', label: '프로필' },
] as const;

function BottomBar({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthSession();
  const ready = !session.isLoading && !session.error && Boolean(session.user);
  const unread = useNotificationCount(session.user?.id, ready);
  const hasUnread = ready && (unread.data ?? 0) > 0;

  return <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
    {destinations.map(({ name, label }) => {
      if (name === 'register') return <Pressable key={name} accessibilityRole="button" accessibilityLabel={label}
        onPress={() => router.push('/pick/new')} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
        <View style={styles.register}><Text accessible={false} style={styles.plus}>＋</Text></View>
      </Pressable>;
      const route = state.routes.find((entry) => entry.name === name);
      const selected = state.routes[state.index]?.name === name;
      const showUnread = name === 'notifications' && hasUnread;
      return <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected }}
        accessibilityLabel={showUnread ? '알림, 읽지 않은 알림 있음' : label}
        onPress={() => {
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
        onLongPress={() => { if (route) navigation.emit({ type: 'tabLongPress', target: route.key }); }}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
        <View accessible={false} style={[styles.marker, selected && styles.markerSelected]} />
        <View style={styles.labelWrap}>
          <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
          {showUnread ? <View testID="notification-unread-dot" accessible={false} style={styles.unread} /> : null}
        </View>
      </Pressable>;
    })}
  </View>;
}

export default function OnePickTabs() {
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <BottomBar {...props} />}>
    <Tabs.Screen name="index" options={{ title: '홈' }} />
    <Tabs.Screen name="explore" options={{ title: '탐색' }} />
    <Tabs.Screen name="register" options={{ href: null }} />
    <Tabs.Screen name="notifications" options={{ title: '알림' }} />
    <Tabs.Screen name="profile" options={{ title: '프로필' }} />
  </Tabs>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexShrink: 0, backgroundColor: '#ffffff', borderTopWidth: 1, borderTopColor: '#e8e8ed', paddingHorizontal: 16 },
  tab: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2 },
  register: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#141416', alignItems: 'center', justifyContent: 'center' },
  plus: { color: '#ffffff', fontSize: 30, lineHeight: 36 },
  marker: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#6b6e78' },
  markerSelected: { backgroundColor: '#131317' },
  labelWrap: { position: 'relative' },
  label: { fontSize: 12, lineHeight: 18, fontWeight: '500', color: '#6b6e78' },
  labelSelected: { color: '#131317' },
  unread: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#ff8a00', top: -9, right: -6 },
  pressed: { opacity: 0.65 },
});
