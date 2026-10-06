import React, { type ErrorInfo, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { OnePickBrand } from '@/components/onepick-brand';
import { Button } from '@/components/ui';
import { observabilityService } from '@/services';
import { OnePick } from '@/constants/onepick';
import { claimChunkReload, isChunkLoadError } from '@/lib/web/chunkReload';

interface Props {
  children: ReactNode;
}

const SHOW_DEBUG_DETAILS = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
const IS_WEB = Platform.OS === 'web' && typeof window !== 'undefined';

interface State {
  hasError: boolean;
  chunkError: boolean;
  retryKey: number;
  debugMessage: string;
  debugComponentStack: string;
}

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, chunkError: false, retryKey: 0, debugMessage: '', debugComponentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      chunkError: isChunkLoadError(error),
      debugMessage: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ debugComponentStack: info.componentStack ?? '' });
    const chunkError = isChunkLoadError(error);
    void observabilityService.captureError(error, chunkError ? 'chunk_load' : 'root_error_boundary');
    // A stale tab after a deploy: reload once to load the new version instead of showing an error.
    if (chunkError && IS_WEB && claimChunkReload(sessionStore(), Date.now())) window.location.reload();
  }

  private retry = () => {
    // Remounting cannot fetch a screen file that no longer exists; only a reload can.
    if (this.state.chunkError && IS_WEB) {
      window.location.reload();
      return;
    }
    this.setState((state) => ({ hasError: false, chunkError: false, retryKey: state.retryKey + 1 }));
  };

  private goHome = () => {
    if (IS_WEB) {
      window.location.assign('/');
      return;
    }
    this.setState((state) => ({ hasError: false, chunkError: false, retryKey: state.retryKey + 1 }));
    setTimeout(() => {
      try {
        router.replace('/');
      } catch {
        // The navigator is not mounted yet; the remount above already cleared the error.
      }
    }, 0);
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.brand}><OnePickBrand compact /></View>
          <Text style={styles.title}>{this.state.chunkError ? '새 버전이 나왔어요.' : '화면을 표시하는 중 문제가 발생했어요.'}</Text>
          <Text style={styles.description}>
            {this.state.chunkError
              ? '앱이 업데이트됐어요. 새로고침하면 최신 버전으로 이어서 볼 수 있어요.'
              : '다시 시도해보고, 같은 문제가 반복되면 홈으로 이동해주세요.'}
          </Text>
          <View style={styles.actions}>
            <Button label={this.state.chunkError ? '새로고침' : '다시 시도'} onPress={this.retry} fullWidth />
            <Button variant="ghost" label="홈으로" onPress={this.goHome} fullWidth />
          </View>
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
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.background, paddingHorizontal: 24 },
  brand: { marginBottom: 12 },
  title: { color: OnePick.text, fontSize: 22, lineHeight: 30, fontWeight: '700', textAlign: 'center', marginTop: 12 },
  description: { maxWidth: 460, color: OnePick.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  actions: { width: '100%', maxWidth: 320, gap: 8, marginTop: 24 },
  debugBox: { maxWidth: 640, maxHeight: 260, width: '100%', marginTop: 24, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, backgroundColor: OnePick.surface },
  debugBoxContent: { padding: 12 },
  debugText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
});
