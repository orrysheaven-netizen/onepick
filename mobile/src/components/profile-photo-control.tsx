import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button } from '@/components/ui';
import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useProfileImage } from '@/hooks/useProfileImage';

function failureMessage(error: unknown) {
  if (error instanceof AppError && (error.code === 'PHOTO_INVALID' || error.code === 'PHOTO_TOO_LARGE')) return '이 사진은 쓸 수 없어요. 다른 사진을 골라 주세요.';
  return '프로필 사진을 바꾸지 못했어요. 다시 시도해 주세요.';
}

/** Tap my photo: no photo opens the picker; an existing photo opens its action menu. */
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
        <Avatar name={name} size={64} tone="subtle" imageUrl={imageUrl} />
        {photo.isPending ? <View style={styles.busy}><ActivityIndicator color={OnePick.onAction} /></View> : null}
      </Pressable>
      <Modal visible={open && !!imageUrl} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable accessibilityRole="button" accessibilityLabel="프로필 사진 메뉴 닫기"
            onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={styles.menu}>
            <Button variant="secondary" label="사진 바꾸기" onPress={choose} disabled={photo.isPending} />
            <Button variant="dangerText" label="사진 삭제하기" onPress={remove} disabled={photo.isPending} />
            <Button variant="secondary" label="닫기" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
      {photo.error ? <Text accessibilityRole="alert" style={styles.error}>{failureMessage(photo.error)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: OnePickSpace.xs },
  busy: { position: 'absolute', inset: 0, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.bgOverlay },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: OnePick.bgOverlay },
  menu: { width: '100%', maxWidth: 358, padding: 16, borderRadius: 16, gap: OnePickSpace.xs, backgroundColor: OnePick.bgDefault },
  error: { ...OnePickType.caption, color: OnePick.textDanger, maxWidth: 160, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
