import { Stack } from 'expo-router';

export const unstable_settings = {
  anchor: 'profile',
};

export default function ProfileTabStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
