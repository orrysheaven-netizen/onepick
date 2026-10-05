import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark, Button, StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useReadNotificationGroup } from '@/hooks/useNotifications';
import { useRevisePendingItem } from '@/hooks/useRegisterPick';
import { queryKeys } from '@/lib/query/queryKeys';
import { isNaverMapUrl } from '@/services/storeFirstService';
import { itemChannelLinkService } from '@/services/itemChannelLinkService';

type Params = {
  itemId?: string | string[];
  notificationReason?: string | string[];
  notificationGroupId?: string | string[];
  notificationSnapshot?: string | string[];
};
const scalar = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'ITEM_LINK_REQUIRED' || error.code === 'LINK_INVALID') return '네이버 지도 링크를 확인해 주세요.';
    if (error.code === 'PLACE_NAME_INVALID') return '상호명은 1~100자로 입력해 주세요.';
    if (error.code === 'ITEM_NAME_NOT_EDITABLE') return '이 매장은 상호명을 바꿀 수 없어요. 매장 링크만 수정해 주세요.';
    if (error.code === 'PLACE_ALREADY_REGISTERED') return '같은 이름과 링크로 등록된 매장이 이미 있어요. 링크를 다시 확인해 주세요.';
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') return '지금은 이 요청을 수정할 수 없어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인해 주세요.';
  }
  return '수정 내용을 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
}

/** Figma 22-2: a 수정 필요 notice opens this screen with the reason and the current values. */
export default function FixRequestScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Params>();
  const itemId = scalar(params.itemId);
  const reason = scalar(params.notificationReason)?.trim();
  const { user, isLoading } = useAuthSession();
  const detail = useItemDetail(itemId, user?.id);
  const links = useQuery({
    queryKey: queryKeys.items.channels(itemId ?? ''),
    queryFn: () => itemChannelLinkService.list(itemId!),
    enabled: Boolean(itemId),
    retry: false,
  });
  const revise = useRevisePendingItem();
  const readNotificationGroup = useReadNotificationGroup(user?.id);
  const groupId = scalar(params.notificationGroupId);
  const snapshot = scalar(params.notificationSnapshot);
  const acknowledged = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!user || !detail.data || !groupId || !snapshot) return;
    const receipt = `${groupId}:${snapshot}`;
    if (acknowledged.current === receipt) return;
    acknowledged.current = receipt;
    void readNotificationGroup.mutateAsync({ groupId, snapshot }).catch(() => {
      if (acknowledged.current === receipt) acknowledged.current = undefined;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, snapshot, detail.data?.item.id, user?.id]);
  const item = detail.data?.item;
  const currentLink = links.data?.find((link) => link.channel === 'offline')?.url ?? links.data?.[0]?.url ?? '';
  const [name, setName] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Existing values fill the fields once they load; edits are kept afterwards.
  useEffect(() => { if (item && name === null) setName(item.name); }, [item, name]);
  useEffect(() => { if (links.isSuccess && link === null) setLink(currentLink); }, [links.isSuccess, currentLink, link]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/notifications'));
  const submit = async () => {
    if (!user || !itemId || !item || revise.isPending) return;
    const nextName = (name ?? '').trim().replace(/\s+/g, ' ');
    const nextLink = (link ?? '').trim();
    if (!nextName) { setError('상호명을 입력해 주세요.'); return; }
    if (nextLink && !isNaverMapUrl(nextLink)) { setError('네이버 지도 링크를 확인해 주세요.'); return; }
    const nameChanged = nextName !== item.name.trim();
    const linkChanged = nextLink !== currentLink.trim();
    if (!nameChanged && !linkChanged) { setError('수정할 상호명이나 매장 링크를 바꿔 주세요.'); return; }
    setError(null);
    try {
      await revise.mutateAsync({
        userId: user.id,
        itemId,
        ...(nameChanged ? { name: nextName } : {}),
        ...(linkChanged && nextLink ? { linkUrl: nextLink } : {}),
      });
      // No completion screen (Figma 22 rule): back to where the notice was opened.
      close();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="뒤로" onPress={close} style={({ pressed }) => [styles.headerSide, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>정보 수정</Text>
        <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.headerSide, styles.headerRight, pressed && styles.pressed]}>
          <Text style={styles.closeText}>닫기</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {isLoading || detail.isPending ? <StateCard loading title="요청 정보를 불러오고 있어요." /> : null}
        {!isLoading && !user ? <StateCard title="로그인이 필요해요." action={{ label: '로그인', variant: 'primary', onPress: () => router.push('/auth/login') }} /> : null}
        {detail.isError ? <StateCard tone="danger" title="요청 정보를 불러오지 못했어요." action={{ label: '다시 불러오기', onPress: () => void detail.refetch() }} /> : null}
        {item ? <>
          <BrandMark size="sm" />
          <Text style={styles.kicker}>수정이 필요해요.</Text>
          <Text style={styles.title}>매장 정보 수정</Text>
          <Text style={styles.subtitle}>안내된 항목만 수정해 다시 보내 주세요.</Text>
          {reason ? <View style={styles.reasonBox}>
            <Text style={styles.reasonTitle}>수정이 필요한 이유</Text>
            <Text style={styles.reasonText}>{reason}</Text>
          </View> : null}

          <Text style={styles.label}>상호명</Text>
          <TextInput accessibilityLabel="상호명" value={name ?? ''} onChangeText={setName} maxLength={100}
            editable={!revise.isPending} style={styles.input} />
          <Text style={styles.label}>매장 링크</Text>
          <TextInput accessibilityLabel="매장 링크" value={link ?? ''} onChangeText={setLink} autoCapitalize="none"
            keyboardType="url" placeholder="https://naver.me/…" placeholderTextColor={OnePick.textTertiary}
            editable={!revise.isPending} style={styles.input} />

          <View style={styles.menuBox}>
            <Text style={styles.menuTitle}>연결 메뉴</Text>
            <View style={styles.chips}>
              {detail.data?.category?.name ? <View style={[styles.chip, styles.chipOn]}><Text style={styles.chipOnText}>{detail.data.category.name}</Text></View> : null}
              <View style={styles.chip}><Text style={styles.chipText}>오프라인 매장</Text></View>
            </View>
            <Text style={styles.menuNote}>메뉴는 그대로 유지</Text>
          </View>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Button size="lg" fullWidth label="수정 내용 보내기" loading={revise.isPending} onPress={() => void submit()} />
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  header: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: OnePickSpace.sm },
  headerSide: { width: 56, minHeight: 44, justifyContent: 'center', paddingHorizontal: OnePickSpace.sm },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: { ...OnePickType.headline, flex: 1, textAlign: 'center', color: OnePick.textPrimary },
  backText: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  closeText: { ...OnePickType.body, color: OnePick.textPrimary },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: OnePickSpace.gutter, paddingTop: OnePickSpace.md, paddingBottom: OnePickSpace.xxxl, gap: OnePickSpace.sm },
  kicker: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  subtitle: { ...OnePickType.body, color: OnePick.textSecondary },
  reasonBox: { borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgAccentSubtle, padding: OnePickSpace.md, gap: OnePickSpace.xs, marginTop: OnePickSpace.sm },
  reasonTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  reasonText: { ...OnePickType.caption, color: OnePick.textSecondary },
  label: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  input: { ...OnePickType.body, minHeight: 48, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgSubtle, paddingHorizontal: OnePickSpace.md, color: OnePick.textPrimary },
  menuBox: { borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.md, padding: OnePickSpace.md, gap: OnePickSpace.sm, marginTop: OnePickSpace.sm },
  menuTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: OnePickSpace.xs },
  chip: { borderRadius: OnePickRadius.full, backgroundColor: OnePick.bgSubtle, paddingHorizontal: OnePickSpace.md, paddingVertical: OnePickSpace.xs },
  chipOn: { backgroundColor: OnePick.actionPrimary },
  chipText: { ...OnePickType.caption, color: OnePick.textPrimary },
  chipOnText: { ...OnePickType.caption, color: OnePick.onAction },
  menuNote: { ...OnePickType.caption, color: OnePick.textSecondary },
  error: { ...OnePickType.body, color: OnePick.textDanger },
  pressed: { opacity: 0.7 },
});
