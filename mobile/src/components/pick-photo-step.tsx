import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useAttachItemPhoto, useChoosePhoto } from '@/hooks/useRegisterPick';
import { showPhotoFailure } from '@/lib/photos/photoFailure';
import type { Item } from '@/types/domain/item';
import type { PickPhotoDraft } from '@/types/domain/photo';

function photoErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'PHOTO_INVALID') return '사진을 읽지 못했어요. JPG·PNG 사진을 다시 선택해주세요.';
    if (error.code === 'PHOTO_TOO_LARGE') return '사진이 너무 커요. 다른 사진을 선택해주세요.';
    if (error.code === 'PHOTO_UPLOAD_FAILED') return '사진을 저장하지 못했어요. 선택한 사진은 그대로 있어요. 다시 시도해주세요.';
  }
  return '사진을 등록하지 못했어요. 다시 시도해주세요.';
}

type Props = {
  userId: string;
  itemId: string;
  disabled?: boolean;
  /** Called with the item returned by the server once its photo is saved. */
  onAttached: (item: Item) => void;
};

/**
 * Required first step of choosing a pick for an item without a photo: no pick is
 * saved without one. The photo is chosen
 * and uploaded on the choose screen itself, so the review typed afterwards is
 * never lost to a round trip through another screen.
 */
export function PickPhotoStep({ userId, itemId, disabled = false, onAttached }: Props) {
  const picker = useChoosePhoto();
  const attachment = useAttachItemPhoto();
  const busy = useRef(false);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const working = picker.isPending || attachment.isPending;

  const choose = async () => {
    if (disabled || busy.current || working) return;
    busy.current = true;
    try {
      const selected = await picker.mutateAsync();
      if (selected) { setPhoto(selected); attachment.reset(); }
    } catch (error) {
      showPhotoFailure(error, 'choose_pick_photo_choose');
    } finally { busy.current = false; }
  };

  const attach = async () => {
    if (disabled || !photo || busy.current || working) return;
    busy.current = true;
    try {
      const saved = await attachment.mutateAsync({ userId, itemId, photo });
      setPhoto(null);
      onAttached(saved);
    } catch (error) {
      showPhotoFailure(error, 'choose_pick_photo_upload');
    } finally { busy.current = false; }
  };

  return <View style={styles.card}>
    <Text style={styles.title}>1. 대표 사진 <Text style={styles.required}>필수</Text></Text>
    <Text style={styles.hint}>아직 사진이 없어요. 이름이 잘 보이는 사진이면 충분하고, 같은 걸 고른 사람들의 원픽 카드에도 함께 표시돼요.</Text>
    {photo ? <>
      <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" />
      <View style={styles.actions}>
        <Button variant="secondary" label="다른 사진 고르기" disabled={disabled || working} onPress={() => void choose()} style={styles.action} />
        <Button label="이 사진 등록하기" disabled={disabled || (working && !attachment.isPending)} loading={attachment.isPending} onPress={() => void attach()} style={styles.action} />
      </View>
    </> : <Button fullWidth variant="soft" label="사진 고르기" disabled={disabled || (working && !picker.isPending)} loading={picker.isPending} onPress={() => void choose()} style={styles.choose} />}
    {picker.isError || attachment.isError ? <Text accessibilityRole="alert" style={styles.error}>{photoErrorMessage(attachment.error ?? picker.error)}</Text> : null}
    <Text style={styles.hint}>사진을 등록해야 원픽을 저장할 수 있어요. 직접 찍었거나 공유할 권한이 있는 사진만 올려주세요.</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, padding: 16, marginTop: 20 },
  title: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  required: { color: OnePick.danger, fontSize: 12, fontWeight: '600' },
  hint: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  preview: { width: '100%', height: 220, borderRadius: 12, marginTop: 12, backgroundColor: OnePick.background },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  action: { flex: 1 },
  choose: { marginTop: 12 },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 8 },
});
