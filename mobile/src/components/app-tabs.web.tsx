import { Tabs, TabList, TabTrigger, TabSlot, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { OnePick } from '@/constants/onepick';
import { OnePickBrand } from './onepick-brand';

export default function AppTabs() {
  const { width } = useWindowDimensions();
  const compact = width < 600;
  return (
    <Tabs style={styles.tabs}>
      <TabList style={[styles.header, styles.headerInner, compact && styles.innerCompact]}>
          <TabTrigger name="home" href="/" asChild>
            <BrandTab />
          </TabTrigger>
            <TabTrigger name="explore" href="/explore" asChild><TabButton>탐색</TabButton></TabTrigger>
            <TabTrigger name="profile" href="/profile" asChild><TabButton avatar>나</TabButton></TabTrigger>
      </TabList>
      <TabSlot style={styles.slot} />
    </Tabs>
  );
}

function BrandTab({ isFocused, ...props }: TabTriggerSlotProps) {
  return <Pressable {...props} accessibilityLabel="ONE PICK 홈" accessibilityState={{ selected: isFocused }} style={({ pressed }) => [styles.brandLink, pressed && styles.pressed]}><OnePickBrand /></Pressable>;
}

function TabButton({ children, isFocused, avatar, ...props }: TabTriggerSlotProps & { avatar?: boolean }) {
  return (
    <Pressable {...props} accessibilityLabel={avatar ? '내 프로필' : '탐색'} accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [styles.link, avatar && styles.avatar, isFocused && styles.active, pressed && styles.pressed]}>
      <Text style={[styles.linkText, isFocused && styles.activeText]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flex: 1, backgroundColor: OnePick.background },
  slot: { flex: 1 },
  header: { backgroundColor: OnePick.background, borderBottomWidth: 1, borderBottomColor: OnePick.border },
  headerInner: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', minHeight: 94, paddingHorizontal: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  innerCompact: { minHeight: 72, paddingHorizontal: 22 },
  brandLink: { marginRight: 'auto' },
  link: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  avatar: { width: 42, paddingHorizontal: 0, backgroundColor: '#EAECF1' },
  linkText: { fontSize: 14, fontWeight: '700', color: OnePick.muted },
  active: { backgroundColor: OnePick.accentSoft },
  activeText: { color: OnePick.accent },
  pressed: { opacity: 0.65 },
});
