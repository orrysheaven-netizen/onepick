import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Button, Icon, StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useRemoveProfileAvatar, useSaveProfileAvatar } from '@/hooks/useProfileAvatar';
import { profileAvatarUrl } from '@/lib/profile/profileAvatar';
import { chooseProfileAvatar, ProfileAvatarError } from '@/lib/profile/profileAvatarUpload';

function PhotoForm({ userId, username, path }: { userId: string; username: string; path: string | null }) {
  const save = useSaveProfileAvatar(userId);
  const remove = useRemoveProfileAvatar(userId);
  const [message, setMessage] = useState<{ tone: 'done' | 'error'; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const pending = save.isPending || remove.isPending;

  const choose = async () => {
    if (busy.current) return;
    busy.current = true;
    setMessage(null); setConfirmRemove(false);
    try {
      const draft = await chooseProfileAvatar();
      if (!draft) return;
      await save.mutateAsync({ draft, previousPath: path });
      if (mounted.current) setMessage({ tone: 'done', text: '프로필 사진을 바꿨어요.' });
    } catch (cause) {
      if (mounted.current) setMessage({ tone: 'error', text: cause instanceof ProfileAvatarError
        ? cause.message : '사진을 올리지 못했어요. 잠시 후 다시 시도해주세요.' });
    } finally {
      busy.current = false;
    }
  };

  const removePhoto = async () => {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    try {
      await remove.mutateAsync(path);
      if (mounted.current) { setConfirmRemove(false); setMessage({ tone: 'done', text: '프로필 사진을 삭제했어요.' }); }
    } catch (cause) {
      if (mounted.current) setMessage({ tone: 'error', text: cause instanceof ProfileAvatarError
        ? cause.message : '프로필 사진을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.' });
    } finally {
      busy.current = false;
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.preview}>
        <Avatar name={username} size={72} tone="subtle" imageUrl={profileAvatarUrl(path)} />
        <Text style={styles.hint}>홈과 프로필에 보여요. 가운데를 정사각형으로 맞춰서 올려요.</Text>
      </View>
      <Button label={path ? '사진 바꾸기' : '사진 등록하기'} accessibilityLabel={path ? '프로필 사진 바꾸기' : '프로필 사진 등록하기'}
        loading={save.isPending} disabled={pending} fullWidth onPress={() => void choose()} />
      {path && !confirmRemove ? <Button variant="secondary" label="사진 삭제하기" accessibilityLabel="프로필 사진 삭제하기"
        disabled={pending} fullWidth onPress={() => { setMessage(null); setConfirmRemove(true); }} /> : null}
      {path && confirmRemove ? <View style={styles.confirm}>
        <Text style={styles.confirmText}>프로필 사진을 삭제하면 아이디 첫 글자가 대신 보여요.</Text>
        <View style={styles.confirmActions}>
          <Button variant="secondary" size="sm" label="닫기" accessibilityLabel="사진 삭제 닫기" disabled={pending}
            onPress={() => setConfirmRemove(false)} />
          <Button variant="danger" size="sm" label="프로필 사진 삭제하기" loading={remove.isPending} disabled={pending}
            onPress={() => void removePhoto()} />
        </View>
      </View> : null}
      {message ? <Text accessibilityRole={message.tone === 'error' ? 'alert' : 'text'}
        style={message.tone === 'error' ? styles.error : styles.done}>{message.text}</Text> : null}
    </View>
  );
}

export default function ProfilePhotoScreen() {
  const router = useRouter();
  const { user, isLoading, error } = useAuthSession();
  const profile = useMyProfile(user?.id);
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/settings');
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={goBack} style={styles.backButton}>
          <Icon name="back" />
        </Pressable>
        <Text style={styles.headerTitle}>프로필 사진</Text>
        <View style={styles.backButton} />
      </View>
      <View style={styles.content}>
        {isLoading ? <StateCard loading title="로그인 상태를 확인하고 있어요." /> :
          !user || error ? <StateCard title="로그인이 필요해요." text="로그인 후 프로필 사진을 바꿀 수 있어요."
            action={{ label: '로그인하기', variant: 'primary', onPress: () => router.push('/auth/login') }} /> :
          profile.isPending ? <StateCard loading title="프로필을 불러오고 있어요." /> :
          profile.isError || !profile.data ? <StateCard title="프로필을 불러오지 못했어요." text="잠시 후 다시 시도해주세요."
            action={{ label: '다시 불러오기', variant: 'secondary', onPress: () => void profile.refetch() }} /> :
          <PhotoForm key={user.id} userId={user.id} username={profile.data.profile.username}
            path={profile.data.profile.profileImageUrl} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: OnePickSpace.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, paddingTop: OnePickSpace.xl },
  form: { gap: OnePickSpace.md },
  preview: { alignItems: 'center', gap: OnePickSpace.md, marginBottom: OnePickSpace.lg },
  hint: { ...OnePickType.caption, color: OnePick.textSecondary, textAlign: 'center' },
  confirm: { gap: OnePickSpace.sm, padding: OnePickSpace.lg, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgSubtle },
  confirmText: { ...OnePickType.body, color: OnePick.textPrimary },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: OnePickSpace.sm },
  done: { ...OnePickType.body, color: OnePick.textSecondary, textAlign: 'center' },
  error: { ...OnePickType.body, color: OnePick.textDanger, textAlign: 'center' },
});
