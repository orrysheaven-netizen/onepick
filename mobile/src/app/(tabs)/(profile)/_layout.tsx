import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'profile',
};

export default function ProfileTabStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
