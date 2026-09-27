import { Link, Slot, usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotificationCount } from '@/hooks/useNotifications';

const tabs = [
  { href: '/', label: '홈' },
  { href: '/explore', label: '탐색' },
  { href: '/pick/new', label: '원픽 등록' },
  { href: '/notifications', label: '알림' },
  { href: '/profile', label: '프로필' },
] as const;

export default function AppTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useAuthSession();
  const ready = !session.isLoading && !session.error && Boolean(session.user);
  const unread = useNotificationCount(session.user?.id, ready);
  const hasUnread = ready && (unread.data ?? 0) > 0;
  return <View style={styles.tabs}>
    <View style={styles.slot}><Slot /></View>
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {tabs.map(({ href, label }) => {
        if (href === '/pick/new') return <Pressable key={href} accessibilityRole="button" accessibilityLabel={label}
          onPress={() => router.push(href)} style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          <View style={styles.register}><Text accessible={false} style={styles.plus}>＋</Text></View>
        </Pressable>;
        const selected = pathname === href;
        const showUnread = href === '/notifications' && hasUnread;
        return <Link key={href} href={href} asChild>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected }}
            accessibilityLabel={showUnread ? '알림, 읽지 않은 알림 있음' : label} style={styles.tab}>
            <View accessible={false} style={[styles.marker, selected && styles.markerSelected]} />
            <View style={styles.labelWrap}>
              <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
              {showUnread ? <View testID="notification-unread-dot" accessible={false} style={styles.unread} /> : null}
            </View>
          </Pressable>
        </Link>;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  tabs: { flex: 1, minHeight: 0, backgroundColor: '#ffffff' },
  slot: { flex: 1, minHeight: 0 },
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
