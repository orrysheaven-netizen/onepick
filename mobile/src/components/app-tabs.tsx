import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { OnePick } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useNotificationCount } from '@/hooks/useNotifications';

// NativeTabs is the deliberate tab-bar geometry exception to OnePick / Icon.
// iOS/Android keep SF Symbols / Material Symbols drawn by the OS; semantics,
// labels and active-state roles must stay aligned with the Figma/Web tab set.

// Home asks for the bar to step aside while the viewer scrolls down (#762, 2026-10-12).
// Same contract as app-tabs.web.tsx: AppTabs is mounted once and its setter is stable.
let applyHomeTabBarHidden: ((hidden: boolean) => void) | null = null;
export function setHomeTabBarHidden(hidden: boolean) {
  applyHomeTabBarHidden?.(hidden);
}

export default function AppTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const [homeTabBarHidden, setHomeTabBarHiddenState] = useState(false);
  applyHomeTabBarHidden = setHomeTabBarHiddenState;
  const auth = useAuthSession();
  const notificationCount = useNotificationCount(auth.user?.id, !auth.isLoading && !auth.error && Boolean(auth.user));
  const hasUnreadNotifications = !notificationCount.isError && (notificationCount.data ?? 0) > 0;
  return (
    <NativeTabs
      // Root `hidden` hides the whole OS tab bar (Expo SDK 57); only Home may hide it.
      hidden={homeTabBarHidden && pathname === '/'}
      backgroundColor={OnePick.bgDefault}
      tintColor={OnePick.actionPrimary}
      indicatorColor={OnePick.bgDefault}
      labelStyle={{
        default: { color: OnePick.textSecondary, fontSize: 12, fontWeight: '500' },
        selected: { color: OnePick.actionPrimary, fontSize: 12, fontWeight: '500' },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>홈</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md="home"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>탐색</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="grid_view" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="register" disabled listeners={{ tabPress: () => router.push('/pick/new') }}>
        <NativeTabs.Trigger.Label>원픽 등록</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf="plus.circle"
          md="add_circle_outline"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Label>알림</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bell', selected: 'bell.fill' }}
          md="notifications"
        />
        <NativeTabs.Trigger.Badge hidden={!hasUnreadNotifications} />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="(profile)" listeners={{ tabPress: () => router.replace('/profile') }}>
        <NativeTabs.Trigger.Label>프로필</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          md="person"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
