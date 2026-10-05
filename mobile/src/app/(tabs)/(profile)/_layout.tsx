import { Stack } from 'expo-router';


export default function ProfileTabStackLayout() {
  return (\n    <Stack screenOptions={{ headerShown: false }}>\n      <Stack.Screen name=\"profile\" />\n      <Stack.Screen name=\"u/[username]\" options={{ gestureEnabled: false }} />\n    </Stack>\n  );
}
