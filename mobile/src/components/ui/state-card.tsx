import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

import { Button } from './button';

type Props = {
  title?: string;
  text?: string;
  /** Spinner instead of the brand mark; used while the first page loads. */
  loading?: boolean;
  /** Error notices get the danger tint on the title. */
  tone?: 'default' | 'danger';
  action?: { label: string; onPress: () => void; accessibilityLabel?: string; disabled?: boolean };
  /** Tighter padding for inline list states (end of page, failed next page). */
  compact?: boolean;
  accessibilityRole?: 'alert';
};

// Empty, loading and error states share one card so a screen never invents a fourth shape.
export function StateCard({ title, text, loading, tone = 'default', action, compact, accessibilityRole }: Props) {
  return (
    <View accessibilityRole={accessibilityRole} style={[styles.card, compact && styles.compact]}>
      {loading
        ? <ActivityIndicator color={OnePick.accent} />
        : compact ? null : <View style={styles.mark}><Text style={styles.markText}>1</Text></View>}
      {title ? <Text style={[styles.title, tone === 'danger' && styles.titleDanger]}>{title}</Text> : null}
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {action ? <View style={styles.action}><Button variant="ghost" size="sm" label={action.label} onPress={action.onPress} accessibilityLabel={action.accessibilityLabel} disabled={action.disabled} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center', gap: 6, padding: 28,
    backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: OnePickRadius.card,
  },
  compact: { padding: 20 },
  mark: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft, marginBottom: 4 },
  markText: { color: OnePick.accentDeep, fontSize: 17, lineHeight: 20, fontWeight: '900' },
  title: { ...OnePickType.body, fontWeight: '700', color: OnePick.text, textAlign: 'center' },
  titleDanger: { color: OnePick.danger },
  text: { ...OnePickType.label, fontWeight: '400', color: OnePick.muted, textAlign: 'center' },
  action: { marginTop: 6 },
});
