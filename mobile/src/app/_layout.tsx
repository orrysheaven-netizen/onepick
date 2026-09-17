import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppQueryProvider } from '@/lib/query/appQueryProvider';
import { OnePick } from '@/constants/onepick';

SplashScreen.preventAutoHideAsync();
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: OnePick.background, card: OnePick.surface, text: OnePick.text, border: OnePick.border, primary: OnePick.accent } };

export default function RootLayout() {
  return (
    <AppQueryProvider>
      <Head><title>OnePick</title></Head>
      <ThemeProvider value={theme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
          <Stack.Screen name="admin/index" options={{ presentation: 'card' }} />
          <Stack.Screen name="admin/reports" options={{ presentation: 'card' }} />
          <Stack.Screen name="pick/find" options={{ presentation: 'card' }} />
          <Stack.Screen name="pick/request" options={{ presentation: 'card' }} />
          <Stack.Screen name="pick/choose" options={{ presentation: 'card' }} />
          <Stack.Screen name="pick/register" options={{ presentation: 'card' }} />
          <Stack.Screen name="auth/login" options={{ presentation: 'card' }} />
          <Stack.Screen name="auth/username" options={{ presentation: 'card' }} />
          <Stack.Screen name="auth/callback" options={{ presentation: 'card' }} />
        </Stack>
      </ThemeProvider>
    </AppQueryProvider>
  );
}
