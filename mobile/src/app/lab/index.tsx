import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCard } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { OnePick } from '@/constants/onepick';

/** `/lab` opens the signed-in user's own 실험실 (the Explore entry has no username to hand over). */
export default function MyLabRedirect() {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const profileQuery = useMyProfile(user?.id);

  if (profileQuery.data) {
    return <Redirect href={{ pathname: '/lab/[username]', params: { username: profileQuery.data.profile.username } }} />;
  }

  const signedOut = !isLoading && !user;
  const failed = Boolean(user) && profileQuery.isError;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.center}>
        {signedOut ? <StateCard title="실험실은 로그인 후 열 수 있어요." text="맛집 외 취향(콘텐츠·테크·스타일)을 따로 모아두는 공간이에요."
          action={{ label: '로그인하기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/login', params: { action: 'profile' } }) }} />
          : failed ? <StateCard tone="danger" title="실험실을 불러오지 못했어요."
            action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => void profileQuery.refetch() }} />
          : <StateCard loading title="실험실을 여는 중이에요." />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
});
