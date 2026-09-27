import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileBioEditor } from '@/components/profile-bio-editor';
import { ProfileSocialLinks } from '@/components/profile-social-links';
import { StateCard } from '@/components/ui';
import { OnePick, OnePickFeatures } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';

export default function ProfileEditScreen() {
  const router = useRouter();
  const session = useAuthSession();
  const profile = useMyProfile(!session.isLoading && !session.error ? session.user?.id : undefined);
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="프로필로 돌아가기" style={styles.back}
        onPress={() => router.canGoBack() ? router.back() : router.replace('/profile')}><Text style={styles.backText}>‹</Text></Pressable>
      <Text style={styles.title}>프로필 편집</Text><View style={styles.back} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {session.isLoading ? <StateCard loading title="로그인 상태를 확인하고 있어요" />
        : session.error ? <StateCard title="로그인 상태를 확인하지 못했어요" action={{ label: '다시 확인', onPress: session.retry }} />
        : !session.user ? <StateCard title="로그인이 필요해요" action={{ label: '로그인', onPress: () => router.push('/auth/login') }} />
        : profile.isPending ? <StateCard loading title="프로필을 불러오고 있어요" />
        : profile.data ? <>
          <Text style={styles.username}>@{profile.data.profile.username}</Text>
          <ProfileBioEditor profileUserId={profile.data.profile.id} bio={profile.data.profile.bio} />
          {OnePickFeatures.profileSocialLinks ? <ProfileSocialLinks profileUserId={profile.data.profile.id} editable /> : null}
        </> : <StateCard title="프로필을 불러오지 못했어요" action={{ label: '다시 불러오기', onPress: () => void profile.refetch() }} />}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
  header: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: OnePick.text, fontSize: 28 },
  title: { color: OnePick.text, fontSize: 16, fontWeight: '700' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: 16 },
  username: { color: OnePick.text, fontSize: 16, fontWeight: '700', marginBottom: 16 },
});
