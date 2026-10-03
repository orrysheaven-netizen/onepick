import { Modal, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { Button, type ButtonVariant } from './button';

type Props = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: Extract<ButtonVariant, 'primary' | 'danger'>;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = '취소',
  confirmVariant = 'primary',
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={() => { if (!busy) onCancel(); }}>
      <View style={styles.backdrop}>
        <View accessibilityRole="alert" accessibilityLabel={title} accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label={cancelLabel}
              disabled={busy}
              onPress={onCancel}
              style={styles.action}
            />
            <Button
              variant={confirmVariant}
              label={confirmLabel}
              loading={busy}
              onPress={onConfirm}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: OnePickSpace.xxl,
    backgroundColor: 'rgba(20,20,22,0.38)',
  },
  card: {
    width: '100%',
    maxWidth: 358,
    borderRadius: OnePickRadius.lg,
    backgroundColor: OnePick.bgDefault,
    padding: OnePickSpace.xl,
  },
  title: { ...OnePickType.title, color: OnePick.textPrimary },
  body: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  actions: { flexDirection: 'row', gap: OnePickSpace.sm, marginTop: OnePickSpace.xl },
  action: { flex: 1 },
});
