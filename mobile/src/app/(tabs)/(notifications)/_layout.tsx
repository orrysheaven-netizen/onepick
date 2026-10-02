import { Stack } from 'expo-router';

export const unstable_settings = {
  anchor: 'notifications',
};

export default function NotificationsTabStack() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
