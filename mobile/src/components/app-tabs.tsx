import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useRouter } from 'expo-router';
import { OnePick } from '@/constants/onepick';

export default function AppTabs() {
  const router = useRouter();
  return (
    <NativeTabs
      backgroundColor={OnePick.surface}
      tintColor={OnePick.accent}
      indicatorColor={OnePick.accentSoft}
      labelStyle={{ selected: { color: OnePick.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>홈</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <NativeTabs.Trigger.Label>탐색</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="grid_view" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="register" disabled listeners={{ tabPress: () => router.push('/pick/new') }}>
        <NativeTabs.Trigger.Label>원픽 등록</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf="plus.circle.fill"
          md="add_circle"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="comments">
        <NativeTabs.Trigger.Label>댓글</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }}
          md="chat_bubble"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>프로필</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          md="person"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
