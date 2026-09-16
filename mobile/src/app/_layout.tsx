import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppQueryProvider } from '@/lib/query/appQueryProvider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AppQueryProvider>
      <Head><title>OnePick</title></Head>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="pick/choose" options={{ presentation: 'card' }} />
          <Stack.Screen name="auth/login" options={{ presentation: 'card' }} />
          <Stack.Screen name="auth/username" options={{ presentation: 'card' }} />
          <Stack.Screen name="auth/callback" options={{ presentation: 'card' }} />
        </Stack>
      </ThemeProvider>
    </AppQueryProvider>
  );
}
