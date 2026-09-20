import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { OnePick } from '@/constants/onepick';
import { useNotificationCount } from '@/hooks/useNotifications';

export function NotificationButton({ userId }: { userId: string }) {
  const router = useRouter();
  const query = useNotificationCount(userId);
  const count = query.isError ? undefined : query.data;
  return <Pressable accessibilityRole="button"
    accessibilityLabel={count === undefined ? '알림 열기' : `알림 열기, 안 읽은 알림 ${count}개`}
    onPress={() => router.push('/notifications')}
    style={({ pressed }) => [styles.button, pressed && { opacity: 0.65 }]}>
    <Text style={styles.label}>알림</Text>
    {count !== undefined && count > 0 ? <Text style={styles.badge}>{count > 99 ? '99+' : count}</Text> : null}
    {query.isError ? <Text style={styles.error} accessibilityLabel="알림 수를 확인하지 못했어요">!</Text> : null}
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  label: { fontSize: 14, fontWeight: '700', color: OnePick.text },
  badge: { fontSize: 12, fontWeight: '700', color: '#FFFFFF', backgroundColor: OnePick.accent, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  error: { color: OnePick.muted, fontSize: 14 },
});
