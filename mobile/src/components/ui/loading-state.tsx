import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';

type Props = {
  label?: string;
  mode?: 'page' | 'inline';
  delayMs?: number;
  accessibilityLabel?: string;
};

export function LoadingState({ label = '불러오고 있어요', mode = 'page', delayMs = 300, accessibilityLabel }: Props) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.base, mode === 'inline' ? styles.inline : styles.page]}>
      <ActivityIndicator color={OnePick.actionPrimary} />
      {mode === 'page' && label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  page: { minHeight: 160, gap: OnePickSpace.sm },
  inline: { minHeight: 44 },
  label: { ...OnePickType.body, color: OnePick.textSecondary, textAlign: 'center' },
});
