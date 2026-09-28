import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

import { BrandMark } from './brand-mark';
import { Button, type ButtonVariant } from './button';

type Props = {
  title?: string;
  text?: string;
  /** Spinner instead of the brand mark; used while the first page loads. */
  loading?: boolean;
  /** Error notices get the danger tint on the title. */
  tone?: 'default' | 'danger';
  /** Ghost by default; pass `variant: 'primary'` when the card is the whole screen (signed-out, onboarding). */
  action?: { label: string; onPress: () => void; accessibilityLabel?: string; disabled?: boolean; variant?: ButtonVariant };
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
        : compact ? null : <View style={styles.mark}><BrandMark soft /></View>}
      {title ? <Text style={[styles.title, tone === 'danger' && styles.titleDanger]}>{title}</Text> : null}
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {action ? <View style={styles.action}><Button variant={action.variant ?? 'ghost'} size={action.variant && action.variant !== 'ghost' ? 'md' : 'sm'} label={action.label} onPress={action.onPress} accessibilityLabel={action.accessibilityLabel} disabled={action.disabled} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center', gap: 6, padding: 28,
    backgroundColor: OnePick.bgDefault, borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.lg,
  },
  compact: { padding: 20 },
  mark: { marginBottom: 4 },
  title: { ...OnePickType.headline, color: OnePick.text, textAlign: 'center' },
  titleDanger: { color: OnePick.danger },
  text: { ...OnePickType.body, color: OnePick.muted, textAlign: 'center' },
  action: { marginTop: 6 },
});
