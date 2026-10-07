import { DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';

import AppFrame from '@/components/app-frame';
import { RootErrorBoundary } from '@/components/root-error-boundary';
import { AnimatedSplashOverlay } from '@/components/splash-overlay';
import SwipeBackEdge from '@/components/swipe-back-edge';
import { OnePick } from '@/constants/onepick';
import { AppQueryProvider } from '@/lib/query/appQueryProvider';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: OnePick.bgDefault,
    card: OnePick.surface,
    text: OnePick.text,
    border: OnePick.border,
    primary: OnePick.accent,
  },
};

function AppStack() {
  return (
    <>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
        <Stack.Screen name="settings" options={{ presentation: 'card' }} />
        <Stack.Screen name="feed" options={{ presentation: 'card' }} />
        <Stack.Screen name="popular" options={{ presentation: 'card' }} />
        <Stack.Screen name="admin" options={{ presentation: 'card', animation: 'none' }} />
        <Stack.Screen name="pick/find" options={{ presentation: 'card' }} />
        <Stack.Screen name="pick/book" options={{ presentation: 'card' }} />
        <Stack.Screen name="pick/request" options={{ presentation: 'card' }} />
        <Stack.Screen name="pick/choose" options={{ presentation: 'card' }} />
        <Stack.Screen name="pick/register" options={{ presentation: 'card' }} />
        <Stack.Screen name="auth/login" options={{ presentation: 'card' }} />
        <Stack.Screen name="auth/username" options={{ presentation: 'card' }} />
        <Stack.Screen name="auth/callback" options={{ presentation: 'card' }} />
        <Stack.Screen name="auth/admin-security" options={{ presentation: 'card', animation: 'none' }} />
      </Stack>
      <SwipeBackEdge />
    </>
  );
}

export default function RootLayout() {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith('/admin');

  return (
    <RootErrorBoundary>
      <AppQueryProvider>
        <Head><title>OnePick</title></Head>
        <ThemeProvider value={theme}>
          {isAdminRoute ? <AppStack /> : <AppFrame><AppStack /></AppFrame>}
        </ThemeProvider>
      </AppQueryProvider>
    </RootErrorBoundary>
  );
}
