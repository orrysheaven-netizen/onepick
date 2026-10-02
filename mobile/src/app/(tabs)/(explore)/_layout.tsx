import { Stack } from 'expo-router';

export const unstable_settings = {
  anchor: 'explore',
};

export default function ExploreTabStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
