import { Tabs, TabList, TabTrigger, TabSlot, type TabTriggerSlotProps } from 'expo-router/ui';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnePick } from '@/constants/onepick';

type TabIcon = 'home' | 'explore' | 'profile';

export default function AppTabs() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <Tabs style={styles.tabs}>
      <TabSlot style={styles.slot} />
      <TabList style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TabTrigger name="home" href="/" asChild><TabButton icon="home" label="홈" /></TabTrigger>
        <TabTrigger name="explore" href="/explore" asChild><TabButton icon="explore" label="탐색" /></TabTrigger>
        <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록" onPress={() => router.push('/pick/find')}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
          <View style={styles.registerIcon}><Text style={styles.plus}>＋</Text></View>
          <Text style={[styles.label, styles.activeLabel]}>원픽 등록</Text>
        </Pressable>
        <TabTrigger name="profile" href="/profile" asChild><TabButton icon="profile" label="내 프로필" /></TabTrigger>
      </TabList>
    </Tabs>
  );
}

function Icon({ name, active }: { name: TabIcon; active?: boolean }) {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? OnePick.accent : OnePick.muted}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'home' ? <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
      : name === 'explore' ? <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>
      : <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 6 0 0 1 16 0v2" /></>}
  </svg>;
}

function TabButton({ icon, label, isFocused, ...props }: TabTriggerSlotProps & { icon: TabIcon; label: string }) {
  return <Pressable {...props} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: isFocused }}
    style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
    <View style={[styles.icon, isFocused && styles.active]}><Icon name={icon} active={isFocused} /></View>
    <Text style={[styles.label, isFocused && styles.activeLabel]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  tabs: { flex: 1, minHeight: 0, backgroundColor: OnePick.background },
  slot: { flex: 1, minHeight: 0 },
  bar: { flexShrink: 0, flexDirection: 'row', backgroundColor: OnePick.surface, borderTopWidth: 1, borderTopColor: OnePick.border, paddingTop: 8 },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 },
  icon: { width: 56, height: 30, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  registerIcon: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accent },
  plus: { color: OnePick.surface, fontSize: 27, lineHeight: 30, fontWeight: '400' },
  active: { backgroundColor: OnePick.accentSoft },
  label: { fontSize: 11, fontWeight: '600', color: OnePick.muted },
  activeLabel: { color: OnePick.accent, fontWeight: '800' },
  pressed: { opacity: 0.65 },
});
