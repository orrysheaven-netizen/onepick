import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useAttachItemPhoto, useChoosePhoto } from '@/hooks/useRegisterPick';
import { ItemPickCount } from '@/components/item-pick-count';
import { ItemReviewCard } from '@/components/item-review-card';
import { PickPhoto } from '@/components/pick-photo';
import { Button, SectionHeader, StateCard } from '@/components/ui';
import type { PickPhotoDraft } from '@/types/domain/photo';
import { showPhotoFailure } from '@/lib/photos/photoFailure';
import { observabilityService } from '@/services';
import type { Item } from '@/types/domain/item';
import { OnePick } from '@/constants/onepick';

function photoErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'PHOTO_INVALID': return '이미지를 읽지 못했어요. 다른 사진을 선택해주세요.';
      case 'PHOTO_TOO_LARGE': return '사진이 서버의 최대 저장 용량을 초과했어요. 다른 사진을 선택해주세요.';
      case 'PHOTO_UPLOAD_FAILED': return '사진 파일은 정상적으로 읽었지만 서버 저장에 실패했어요. 잠시 후 다시 시도해주세요.';
      case 'ITEM_NOT_ELIGIBLE': return '현재 이 제품에는 이미지를 추가할 수 없어요.';
      case 'AUTH_REQUIRED': return '로그인 상태를 다시 확인해주세요.';
      case 'PROFILE_NOT_FOUND': return '사용자명을 먼저 정해주세요.';
    }
  }
  return '대표 이미지를 추가하지 못했어요. 잠시 후 다시 시도해주세요.';
}

type Params = { itemId?: string; pickId?: string; photo?: string };
export default function ItemDetailScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  // A file selected for one item/account must never be submitted for another.
  return <ItemDetailContent key={`${auth.user?.id ?? 'anonymous'}:${params.itemId ?? ''}`} auth={auth} params={params} />;
}

function ItemDetailContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  const focusPickId = typeof params.pickId === 'string' ? params.pickId : undefined;
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = auth;
  const query = useItemDetail(itemId, user?.id, focusPickId, true, !isSessionLoading && !sessionError);
  const trackedItemId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const data = query.data;
    if (!data) return;
    const viewedItemId = data.item.id;
    if (trackedItemId.current === viewedItemId) return;
    trackedItemId.current = viewedItemId;
    void observabilityService.captureProductEvent({
      eventName: 'item_detail_viewed',
      itemId: viewedItemId,
      categoryId: data.item.categoryId,
      pickId: focusPickId ?? null,
      source: focusPickId ? 'pick_route' : 'direct_or_browse',
      path: '/item/[itemId]',
    });
  }, [focusPickId, query.data?.item.categoryId, query.data?.item.id]);

  const scroll = useRef<ScrollView>(null);
  const reviewPositions = useRef<Record<string, number>>({});
  const [highlightedId, setHighlightedId] = useState<string>();
  const [focusRevision, setFocusRevision] = useState(0);
  const scrolledTo = useRef<string | undefined>(undefined);
  const focusReview = useCallback((id: string) => {
    const y = reviewPositions.current[id];
    if (y === undefined) return;
    scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
    setHighlightedId(id);
    setFocusRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    scrolledTo.current = undefined;
    // A photo invitation opens the uploader, not a review far below it.
    if (params.photo !== '1' && focusPickId && reviewPositions.current[focusPickId] !== undefined) {
      focusReview(focusPickId);
      scrolledTo.current = focusPickId;
    }
  }, [focusPickId, focusReview, user?.id, params.photo]);
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(undefined), 4000);
    return () => clearTimeout(timer);
  }, [highlightedId, focusRevision]);

  const photoPicker = useChoosePhoto();
  const photoAttachment = useAttachItemPhoto();
  const busy = useRef(false);
  const photoAcknowledged = useRef(false);
  const refreshing = useRef(false);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [savedItem, setSavedItem] = useState<Item | null>(null);
  const currentItem = savedItem ?? query.data?.item;
  const hasPhoto = Boolean(currentItem?.imagePath || currentItem?.imageUrl || currentItem?.thumbnailUrl || currentItem?.imageSourceUrl);
  const canContribute = Boolean(itemId && !query.isError && currentItem && ['active', 'discontinued'].includes(currentItem.status) && !hasPhoto);
  const photoBusy = photoPicker.isPending || photoAttachment.isPending;
  const photoIntent = { action: 'add_item_photo', itemId: itemId ?? '' };

  const choosePhoto = async () => {
    if (!user || isSessionLoading || sessionError || !canContribute || busy.current || photoBusy || photoAcknowledged.current) return;
    busy.current = true;
    try {
      const selected = await photoPicker.mutateAsync();
      if (selected) {
        setPhoto(selected);
        photoAttachment.reset();
      }
    } catch (error) {
      showPhotoFailure(error, 'item_photo_choose');
    }
    finally { busy.current = false; }
  };

  const attachPhoto = async () => {
    if (!user || isSessionLoading || sessionError || !canContribute || !itemId || !photo || busy.current || photoAcknowledged.current) return;
    busy.current = true;
    try {
      const saved = await photoAttachment.mutateAsync({ userId: user.id, itemId, photo });
      // A later read failure must not authorize another write from an old handler.
      photoAcknowledged.current = true;
      setSavedItem(saved);
      setPhoto(null);
      // Refresh is a separate operation. Preserve the acknowledged response and
      // keep all stale product/review content hidden if the fresh read fails.
      await query.refetch().catch(() => {});
    } catch (error) {
      showPhotoFailure(error, 'item_photo_upload');
    }
    finally { busy.current = false; }
  };
  const retryItem = async () => {
    if (!itemId || isSessionLoading || sessionError || query.isFetching || busy.current || refreshing.current) return;
    refreshing.current = true;
    try { await query.refetch({ cancelRefetch: false }); }
    catch { /* Query state keeps the error and retry visible. */ }
    finally { refreshing.current = false; }
  };

  if (!isSessionLoading && sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><View style={styles.centerState}>
      <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요" action={{ label: '다시 확인하기', variant: 'secondary', onPress: retrySession }} />
    </View></SafeAreaView>;
  }

  if (isSessionLoading || (Boolean(itemId) && query.isPending && !savedItem)) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <StateCard loading title="제품 정보를 불러오고 있어요" />
        </View>
      </SafeAreaView>
    );
  }

  if (!itemId || query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <StateCard tone={savedItem ? 'default' : 'danger'} title={savedItem ? '사진 등록 요청은 처리됐어요' : '제품을 볼 수 없어요'}
            text={savedItem
              ? '서버의 처리 응답은 받았지만 최신 상품 정보를 확인하지 못했어요. 다시 불러와 현재 사진을 확인해주세요.'
              : '연결 상태를 확인한 뒤 다시 시도해주세요. 제품이 없거나 공개되지 않은 링크일 수도 있어요.'}
            action={itemId ? { label: query.isFetching ? '다시 불러오는 중…' : '제품 정보 다시 불러오기', accessibilityLabel: '제품 정보 다시 불러오기', variant: 'secondary', disabled: query.isFetching, onPress: () => void retryItem() } : undefined} />
          <Button variant="ghost" label="돌아가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.centered} />
        </View>
      </SafeAreaView>
    );
  }

  const { category, myPickStatus, picks, canChoose } = query.data;
  const item = savedItem ?? query.data.item;
  const credit = query.photoCredit && query.photoCredit.itemId === item.id && query.photoCredit.imagePath === item.imagePath
    && query.photoCredit.imageSourceUrl === (item.imageSourceUrl ?? null) ? query.photoCredit : null;
  const openPickAction = () => {
    if (myPickStatus.type === 'selected_this') {
      focusReview(myPickStatus.pickId);
      return;
    }
    if (!canChoose) return;
    router.push({ pathname: '/pick/choose', params: { itemId: item.id, categoryId: item.categoryId } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <View style={styles.heroCard}>
          <PickPhoto uri={item.imageUrl ?? item.thumbnailUrl ?? item.imageSourceUrl} label={item.name} large={hasPhoto || params.photo !== '1'} />
          {credit ? <Pressable accessibilityRole="button" accessibilityLabel={`사진 등록자 @${credit.username} 프로필 보기`}
            onPress={() => router.push({ pathname: '/u/[username]', params: { username: credit.username } })} style={styles.creditLink}>
            <Text style={styles.creditText}>사진 등록 · @{credit.username}</Text>
          </Pressable> : null}
          {photoAcknowledged.current && credit && credit.userId === user?.id ?
            <Text accessibilityLiveRegion="polite" style={styles.photoContributionHint}>사진을 보태주셨어요. 같은 상품을 고른 사람들도 이 사진을 함께 사용해요.</Text> : null}
          {canContribute ? (
            <View style={styles.photoContribution}>
              <Text style={styles.photoContributionTitle}>{item.name} 사진 등록</Text>
              <Text style={styles.photoContributionHint}>상품 이름이 잘 보이는 사진이면 충분해요. 직접 찍었거나 공유할 권한이 있는 사진을 골라주세요.</Text>
              <Text style={styles.photoContributionHint}>채택된 사진은 같은 상품의 원픽 카드에 함께 표시돼요. 상품 상세에 사진 등록자로 내 사용자명이 표시되고 프로필이 연결돼요. 사진 없이도 원픽을 이용할 수 있어요.</Text>
              {!user ? <Button fullWidth label="로그인하고 사진 등록" onPress={() => router.push({ pathname: '/auth/login', params: photoIntent })} style={styles.photoChooseButton} /> : <>
              {photo ? (
                <>
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" />
                  <View style={styles.photoActions}>
                    <Button variant="secondary" label="다시 선택" disabled={photoBusy} onPress={() => void choosePhoto()} style={styles.photoAction} />
                    <Button label="대표 이미지 등록" disabled={photoBusy && !photoAttachment.isPending} loading={photoAttachment.isPending} onPress={() => void attachPhoto()} style={styles.photoAction} />
                  </View>
                  <Button variant="ghost" size="sm" label="사진 선택 취소" disabled={photoBusy} onPress={() => { setPhoto(null); photoAttachment.reset(); }} style={styles.centered} />
                </>
              ) : (
                <Button fullWidth label="사진 선택" disabled={photoBusy && !photoPicker.isPending} loading={photoPicker.isPending} onPress={() => void choosePhoto()} style={styles.photoChooseButton} />
              )}
              {photoPicker.isError ? <Text accessibilityRole="alert" style={styles.photoError}>{photoErrorMessage(photoPicker.error)}</Text> : null}
              {photoAttachment.isError ? <Text accessibilityRole="alert" style={styles.photoError}>{photoErrorMessage(photoAttachment.error)}</Text> : null}
              {photoAttachment.error instanceof AppError && photoAttachment.error.code === 'PROFILE_NOT_FOUND' ?
                <Button variant="secondary" size="sm" label="사용자명 만들고 계속하기" onPress={() => router.push({ pathname: '/auth/username', params: photoIntent })} style={styles.photoRecovery} /> : null}
              {photoAttachment.error instanceof AppError && photoAttachment.error.code === 'AUTH_REQUIRED' ?
                <Button variant="secondary" size="sm" label="다시 로그인하고 계속" onPress={() => router.push({ pathname: '/auth/login', params: photoIntent })} style={styles.photoRecovery} /> : null}
              </>}
            </View>
          ) : null}
          <Text style={styles.category}>{category?.name ?? '카테고리'}</Text>
          <Text style={styles.itemName}>{item.name}</Text>
          <ItemPickCount itemId={item.id} />
          <Text style={styles.itemMeta}>이 상품을 원픽으로 고른 사람들의 한줄평을 아래에서 함께 볼 수 있어요.</Text>

          {canChoose || myPickStatus.type === 'selected_this' ? (
            <Button size="lg" fullWidth onPress={openPickAction} style={styles.primaryAction}
              label={myPickStatus.type === 'selected_this' ? '내 원픽 한줄평 보기/수정'
                : myPickStatus.type === 'selected_other' ? '이 제품으로 원픽 바꾸기'
                  : myPickStatus.type === 'can_add' ? '내 원픽에 추가'
                    : myPickStatus.type === 'category_full' ? '내 원픽 하나와 바꾸기' : '이 제품으로 원픽 등록'} />
          ) : <Text style={styles.itemMeta}>현재 이 제품이나 카테고리에서는 새 원픽을 선택할 수 없어요.</Text>}
        </View>

        <View style={styles.sectionHeader}>
          <SectionHeader title="원픽 한줄평" description="각 한줄평에서 댓글로 대화해요" />
        </View>

        {focusPickId && query.data.focusAvailable === false ? <Text style={styles.stateText}>연결된 한줄평이 삭제되었거나 공개되지 않았어요.</Text> : null}
        {picks.length > 0 ? (
          picks.map(({ pick, profile }) => (
            <View key={`${user?.id ?? 'public'}:${pick.id}`} onLayout={(event) => {
              reviewPositions.current[pick.id] = event.nativeEvent.layout.y;
              if (params.photo !== '1' && pick.id === focusPickId && scrolledTo.current !== focusPickId) {
                focusReview(pick.id);
                scrolledTo.current = pick.id;
              }
            }}>
              <ItemReviewCard pick={pick} profile={profile} categoryName={category?.name ?? '카테고리'}
                itemName={item.name} focused={params.photo !== '1' && pick.id === focusPickId} highlighted={pick.id === highlightedId}
                onRemoved={() => { router.setParams({ pickId: undefined }); void query.refetch(); }} />
            </View>
          ))
        ) : (
          <StateCard title="아직 다른 사람의 한줄평이 없어요" text={canChoose ? '첫 번째로 이 제품을 원픽으로 선택할 수 있어요.' : '새로운 선택을 받을 수 없는 제품이나 카테고리입니다.'} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  centered: { alignSelf: 'center' },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: OnePick.text, fontSize: 36, lineHeight: 38, fontWeight: '300' },
  heroCard: { alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 24, marginTop: 8 },
  creditLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  creditText: { color: OnePick.muted, fontSize: 12, lineHeight: 18 },
  photoContribution: { width: '100%', backgroundColor: OnePick.accentSoft, borderRadius: 20, padding: 16, marginTop: 18 },
  photoContributionTitle: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  photoContributionHint: { color: OnePick.muted, fontSize: 13, lineHeight: 18, marginTop: 6 },
  photoPreview: { width: '100%', height: 210, borderRadius: 14, backgroundColor: OnePick.surface, marginTop: 14 },
  photoActions: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  photoAction: { flex: 1 },
  photoRecovery: { marginTop: 10 },
  photoChooseButton: { marginTop: 14 },
  photoError: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 10 },
  category: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 20 },
  itemName: { color: OnePick.text, fontSize: 22, lineHeight: 30, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginTop: 6 },
  itemMeta: { color: OnePick.muted, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  primaryAction: { marginTop: 20 },
  sectionHeader: { marginTop: 28, marginBottom: 12 },
  centerState: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  stateText: { color: OnePick.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  pressed: { opacity: 0.7 },
});
