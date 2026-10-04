import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button } from '@/components/ui';
import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useProfileImage } from '@/hooks/useProfileImage';

function failureMessage(error: unknown) {
  if (error instanceof AppError && (error.code === 'PHOTO_INVALID' || error.code === 'PHOTO_TOO_LARGE')) return '이 사진은 쓸 수 없어요. 다른 사진을 골라 주세요.';
  return '프로필 사진을 바꾸지 못했어요. 다시 시도해 주세요.';
}

/** My profile (user decision 10-05): tap the profile image → 사진 선택 / 사진 삭제. */
export function ProfilePhotoControl({ userId, name, imageUrl }: { userId: string; name: string; imageUrl: string | null }) {
  const [open, setOpen] = useState(false);
  const photo = useProfileImage(userId, imageUrl);
  const choose = () => {
    setOpen(false);
    photo.change.mutate();
  };
  const remove = () => {
    setOpen(false);
    photo.clear.mutate();
  };

  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" accessibilityLabel="프로필 사진 바꾸기" accessibilityState={{ expanded: open, busy: photo.isPending }}
        disabled={photo.isPending} onPress={() => (imageUrl ? setOpen((value) => !value) : choose())}
        style={({ pressed }) => pressed && styles.pressed}>
        <Avatar name={name} size={72} tone="subtle" imageUrl={imageUrl} />
        {photo.isPending ? <View style={styles.busy}><ActivityIndicator color={OnePick.onAction} /></View> : null}
      </Pressable>
      {open ? <View style={styles.menu}>
        <Button variant="secondary" size="sm" label="사진 선택" onPress={choose} />
        <Button variant="dangerText" size="sm" label="사진 삭제" onPress={remove} />
      </View> : null}
      {photo.error ? <Text accessibilityRole="alert" style={styles.error}>{failureMessage(photo.error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: OnePickSpace.xs },
  busy: { position: 'absolute', inset: 0, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.bgOverlay },
  menu: { flexDirection: 'row', gap: OnePickSpace.xs },
  error: { ...OnePickType.caption, color: OnePick.textDanger, maxWidth: 160, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
