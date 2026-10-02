import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FollowConnectionsView } from '@/components/follow-connections-view';
import { StateCard } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import { usePublicProfile } from '@/hooks/usePublicProfile';
import { armFollowProfileIntent } from '@/lib/auth/followProfileIntent';
import { OnePick } from '@/constants/onepick';
import type { FollowDirection } from '@/types/domain/safety';

function asDirection(value: string | string[] | undefined): FollowDirection {
  return value === 'following' ? 'following' : 'followers';
}

export default function FollowConnectionsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ username?: string; direction?: string }>();
  const username = typeof params.username === 'string' ? params.username : undefined;
  const direction = asDirection(params.direction);
  const auth = useAuthSession();
  const profileQuery = usePublicProfile(username, auth.user?.id);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (username) router.replace({ pathname: '/u/[username]', params: { username } });
    else router.replace('/');
  };

  if (!username) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: OnePick.bgDefault }} edges={['top']}>
        <StateCard title="프로필을 찾을 수 없어요" action={{ label: '홈으로', onPress: () => router.replace('/') }} />
      </SafeAreaView>
    );
  }

  if (profileQuery.isPending) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: OnePick.bgDefault }} edges={['top']}>
        <StateCard loading title="연결 목록을 준비하고 있어요" />
      </SafeAreaView>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: OnePick.bgDefault }} edges={['top']}>
        <StateCard
          tone="danger"
          title="프로필을 불러오지 못했어요"
          text="연결 상태를 확인한 뒤 다시 시도해주세요."
          action={{ label: '다시 불러오기', onPress: () => void profileQuery.refetch() }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: OnePick.bgDefault }} edges={['top']}>
      <FollowConnectionsView
        profileId={profileQuery.data.profile.id}
        ownerUsername={profileQuery.data.profile.username}
        viewerUserId={auth.user?.id}
        initialDirection={direction}
        onBack={goBack}
        onOpenProfile={(targetUsername) => router.push({ pathname: '/u/[username]', params: { username: targetUsername } })}
        onRequireLogin={(targetUsername) => {
          armFollowProfileIntent(targetUsername);
          router.push({ pathname: '/auth/login', params: { action: 'follow_profile', username: targetUsername } });
        }}
      />
    </SafeAreaView>
  );
}
