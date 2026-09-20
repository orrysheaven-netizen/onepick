import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'onepick:youtube-policy-consent:v1';

export async function getYouTubePolicyConsent() {
  return (await AsyncStorage.getItem(KEY)) === 'accepted';
}

export async function acceptYouTubePolicyConsent() {
  await AsyncStorage.setItem(KEY, 'accepted');
}

export async function revokeYouTubePolicyConsent() {
  await AsyncStorage.removeItem(KEY);
}
