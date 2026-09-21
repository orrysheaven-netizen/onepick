import React, { type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OnePickBrand } from '@/components/onepick-brand';
import { observabilityService } from '@/services';
import { OnePick } from '@/constants/onepick';

interface Props {
  children: ReactNode;
}

const SHOW_DEBUG_DETAILS = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

interface State {
  hasError: boolean;
  retryKey: number;
  debugMessage: string;
  debugComponentStack: string;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, retryKey: 0, debugMessage: '', debugComponentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, debugMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ debugComponentStack: info.componentStack ?? '' });
    void observabilityService.captureError(error, 'root_error_boundary');
  }

  private retry = () => {
    this.setState((state) => ({ hasError: false, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.brand}><OnePickBrand compact /></View>
          <Text style={styles.title}>화면을 표시하는 중 문제가 발생했어요</Text>
          <Text style={styles.description}>입력하던 내용은 그대로일 수 있습니다. 다시 시도해보고, 같은 문제가 반복되면 앱을 다시 열어주세요.</Text>
          <Pressable accessibilityRole="button" onPress={this.retry} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>다시 시도</Text>
          </Pressable>
          {SHOW_DEBUG_DETAILS && (this.state.debugMessage || this.state.debugComponentStack) && (
            <ScrollView style={styles.debugBox} contentContainerStyle={styles.debugBoxContent}>
              <Text selectable style={styles.debugText}>{this.state.debugMessage}{'\n'}{this.state.debugComponentStack}</Text>
            </ScrollView>
          )}
        </View>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.background, paddingHorizontal: 28 },
  brand: { marginBottom: 12 },
  title: { color: OnePick.text, fontSize: 22, lineHeight: 30, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  description: { maxWidth: 460, color: OnePick.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  button: { minHeight: 48, borderRadius: 15, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 22 },
  buttonText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  debugBox: { maxWidth: 640, maxHeight: 260, width: '100%', marginTop: 24, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, backgroundColor: OnePick.surface },
  debugBoxContent: { padding: 12 },
  debugText: { color: OnePick.muted, fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
});
