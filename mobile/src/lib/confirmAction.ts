import { Alert, Platform } from 'react-native';

/** One confirmation step before an account action (Figma 68: 로그아웃·계정 삭제). */
export function confirmAction(title: string, message: string, confirmLabel: string, destructive = false): Promise<boolean> {
  // react-native-web implements Alert.alert as a no-op, so browsers get the native dialog instead.
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${title}\n\n${message}`)
      : false);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: '취소', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
