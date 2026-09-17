import { DarkTheme, DefaultTheme, ThemeProvider, Slot, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith('/admin');

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {isAdminRoute ? <Slot /> : <AppTabs />}
    </ThemeProvider>
  );
}
