import React, { type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { observabilityService } from '@/services';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryKey: number;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, retryKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    void observabilityService.captureError(error, 'root_error_boundary');
  }

  private retry = () => {
    this.setState((state) => ({ hasError: false, retryKey: state.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.kicker}>ONEPICK</Text>
          <Text style={styles.title}>화면을 표시하는 중 문제가 발생했어요</Text>
          <Text style={styles.description}>입력하던 내용은 그대로일 수 있습니다. 다시 시도해보고, 같은 문제가 반복되면 앱을 다시 열어주세요.</Text>
          <Pressable accessibilityRole="button" onPress={this.retry} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <Text style={styles.buttonText}>다시 시도</Text>
          </Pressable>
        </View>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F6F8', paddingHorizontal: 28 },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { color: '#202124', fontSize: 22, lineHeight: 30, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  description: { maxWidth: 460, color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  button: { minHeight: 48, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 22 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
