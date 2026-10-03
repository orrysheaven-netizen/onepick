import type { ReactNode } from 'react';
import { KeyboardAvoidingView, StyleSheet } from 'react-native';

// Lifts a form above the on-screen keyboard. Android is edge-to-edge (the window no longer
// resizes), so both native platforms use padding; on web there is no keyboard overlay to avoid.
export function KeyboardAvoidingForm({ children }: { children: ReactNode }) {
  return <KeyboardAvoidingView style={styles.fill} behavior="padding">{children}</KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
