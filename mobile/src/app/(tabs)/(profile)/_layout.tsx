import { Stack } from 'expo-router';

export default function ProfileTabStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="profile" />
      <Stack.Screen name="u/[username]" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
