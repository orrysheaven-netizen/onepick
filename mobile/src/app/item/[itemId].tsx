import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useAttachItemPhoto, useChoosePhoto } from '@/hooks/useRegisterPick';
import { ItemPickCount } from '@/components/item-pick-count';
import { ItemReviewCard } from '@/components/item-review-card';
import { PickPhoto } from '@/components/pick-photo';
import type { PickPhotoDraft } from '@/types/domain/photo';
import { observabilityService } from '@/services';

function photoErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'PHOTO_INVALID': return '이미지를 읽지 못했어요. 다른 사진을 선택해주세요.';
      case 'PHOTO_TOO_LARGE': return '사진이 너무 커요. 더 작은 사진을 선택해주세요.';
      case 'PHOTO_UPLOAD_FAILED': return '사진을 저장하지 못했어요. 다시 시도해주세요.';
      case 'ITEM_NOT_ELIGIBLE': return '현재 이 제품에는 이미지를 추가할 수 없어요.';
      case 'AUTH_REQUIRED': return '로그인 상태를 다시 확인해주세요.';
      case 'PROFILE_NOT_FOUND': return '사용자명을 먼저 정해주세요.';
    }
  }
  return '대표 이미지를 추가하지 못했어요. 잠시 후 다시 시도해주세요.';
}

export default function ItemDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ itemId?: string; pickId?: string }>();
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  const focusPickId = typeof params.pickId === 'string' ? params.pickId : undefined;
  const { user } = useAuthSession();
  const query = useItemDetail(itemId, user?.id, focusPickId);
  const trackedItemId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const viewedItemId = query.data?.item.id;
    if (!viewedItemId || trackedItemId.current === viewedItemId) return;
    trackedItemId.current = viewedItemId;
    void observabilityService.captureProductEvent({
      eventName: 'item_detail_viewed',
      itemId: viewedItemId,
      categoryId: query.data.item.categoryId,
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
    if (focusPickId && reviewPositions.current[focusPickId] !== undefined) {
      focusReview(focusPickId);
      scrolledTo.current = focusPickId;
    }
  }, [focusPickId, focusReview, user?.id]);
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(undefined), 4000);
    return () => clearTimeout(timer);
  }, [highlightedId, focusRevision]);

  const photoPicker = useChoosePhoto();
  const photoAttachment = useAttachItemPhoto();
  const busy = useRef(false);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [photoApproved, setPhotoApproved] = useState(false);

  const choosePhoto = async () => {
    if (busy.current || photoPicker.isPending || photoAttachment.isPending) return;
    busy.current = true;
    try {
      const selected = await photoPicker.mutateAsync();
      if (selected) {
        setPhoto(selected);
        setPhotoApproved(false);
        photoAttachment.reset();
      }
    } catch { /* The mutation renders an actionable error below. */ }
    finally { busy.current = false; }
  };

  const attachPhoto = async () => {
    if (!user || !itemId || !photo || !photoApproved || busy.current) return;
    busy.current = true;
    try {
      await photoAttachment.mutateAsync({ userId: user.id, itemId, photo });
      setPhoto(null);
      setPhotoApproved(false);
      await query.refetch();
    } catch { /* Keep the selected image for retry. */ }
    finally { busy.current = false; }
  };

  if (query.isPending) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator />
          <Text style={styles.stateText}>제품 정보를 불러오고 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>제품을 볼 수 없어요</Text>
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { item, category, myPickStatus, picks, canChoose } = query.data;
  const openPickAction = () => {
    if (myPickStatus.type === 'selected_this') {
      focusReview(myPickStatus.pickId);
      return;
    }
    if (!canChoose) return;
    router.push({ pathname: '/pick/register', params: { itemId: item.id, categoryId: item.categoryId } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <View style={styles.heroCard}>
          <PickPhoto uri={item.imageUrl} label={item.name} large />
          {!item.imagePath && user ? (
            <View style={styles.photoContribution}>
              <Text style={styles.photoContributionTitle}>대표 이미지가 비어 있어요</Text>
              <Text style={styles.photoContributionHint}>직접 찍었거나 사용 권한이 있는 제품 사진을 첫 대표 이미지로 공유할 수 있어요.</Text>
              {photo ? (
                <>
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" />
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: photoApproved }}
                    disabled={photoAttachment.isPending}
                    onPress={() => setPhotoApproved((approved) => !approved)}
                    style={({ pressed }) => [styles.photoConsent, pressed && styles.pressed]}>
                    <Text style={styles.photoConsentText}>{photoApproved ? '☑' : '☐'} 이 제품의 사진이 맞으며 대표 이미지로 공유할 수 있어요</Text>
                  </Pressable>
                  <View style={styles.photoActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={photoAttachment.isPending}
                      onPress={() => void choosePhoto()}
                      style={({ pressed }) => [styles.photoSecondaryButton, pressed && styles.pressed]}>
                      <Text style={styles.photoSecondaryText}>다시 선택</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={!photoApproved || photoAttachment.isPending}
                      onPress={() => void attachPhoto()}
                      style={({ pressed }) => [styles.photoPrimaryButton, (!photoApproved || photoAttachment.isPending) && styles.disabled, pressed && styles.pressed]}>
                      {photoAttachment.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.photoPrimaryText}>대표 이미지 등록</Text>}
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={photoPicker.isPending}
                  onPress={() => void choosePhoto()}
                  style={({ pressed }) => [styles.photoPrimaryButton, styles.photoChooseButton, pressed && styles.pressed]}>
                  {photoPicker.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.photoPrimaryText}>사진 선택</Text>}
                </Pressable>
              )}
              {photoPicker.isError ? <Text accessibilityRole="alert" style={styles.photoError}>{photoErrorMessage(photoPicker.error)}</Text> : null}
              {photoAttachment.isError ? <Text accessibilityRole="alert" style={styles.photoError}>{photoErrorMessage(photoAttachment.error)}</Text> : null}
            </View>
          ) : null}
          <Text style={styles.category}>{category?.name ?? '카테고리'}</Text>
          <Text style={styles.itemName}>{item.name}</Text>
          <ItemPickCount itemId={item.id} />
          <Text style={styles.itemMeta}>
            이 상품을 원픽으로 고른 사람들의 한줄평을 아래에서 함께 볼 수 있어요.
          </Text>

          {canChoose || myPickStatus.type === 'selected_this' ? (
            <Pressable accessibilityRole="button" onPress={openPickAction} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>
                {myPickStatus.type === 'selected_this'
                  ? '내 원픽 한줄평 보기/수정'
                  : myPickStatus.type === 'selected_other'
                    ? '이 제품으로 원픽 바꾸기'
                    : '이 제품으로 원픽 등록'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.itemMeta}>현재 이 제품이나 카테고리에서는 새 원픽을 선택할 수 없어요.</Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>원픽 한줄평</Text>
          <Text style={styles.sectionHint}>각 한줄평에서 답글로 대화해요</Text>
        </View>

        {focusPickId && query.data.focusAvailable === false ? <Text style={styles.stateText}>연결된 한줄평이 삭제되었거나 공개되지 않았어요.</Text> : null}
        {picks.length > 0 ? (
          picks.map(({ pick, profile }) => (
            <View key={`${user?.id ?? 'public'}:${pick.id}`} onLayout={(event) => {
              reviewPositions.current[pick.id] = event.nativeEvent.layout.y;
              if (pick.id === focusPickId && scrolledTo.current !== focusPickId) {
                focusReview(pick.id);
                scrolledTo.current = pick.id;
              }
            }}>
              <ItemReviewCard pick={pick} profile={profile} categoryName={category?.name ?? '카테고리'}
                itemName={item.name} focused={pick.id === focusPickId} highlighted={pick.id === highlightedId}
                onRemoved={() => { router.setParams({ pickId: undefined }); void query.refetch(); }} />
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 다른 사람의 한줄평이 없어요</Text>
            <Text style={styles.emptyText}>{canChoose ? '첫 번째로 이 제품을 원픽으로 선택할 수 있어요.' : '새로운 선택을 받을 수 없는 제품이나 카테고리입니다.'}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  heroCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 26, padding: 28, marginTop: 8 },
  photoContribution: { width: '100%', borderWidth: 1, borderColor: '#DDDDF5', backgroundColor: '#F7F7FF', borderRadius: 18, padding: 16, marginTop: 18 },
  photoContributionTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  photoContributionHint: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 6 },
  photoPreview: { width: '100%', height: 210, borderRadius: 14, backgroundColor: '#FFFFFF', marginTop: 14 },
  photoConsent: { minHeight: 48, justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 13, paddingHorizontal: 13, marginTop: 10 },
  photoConsentText: { color: '#202124', fontSize: 12, lineHeight: 18, fontWeight: '700' },
  photoActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  photoPrimaryButton: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  photoChooseButton: { marginTop: 14 },
  photoPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  photoSecondaryButton: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D4D6DD', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  photoSecondaryText: { color: '#202124', fontSize: 13, fontWeight: '800' },
  photoError: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 10 },
  itemIcon: { width: 122, height: 122, borderRadius: 30, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  itemEmoji: { fontSize: 58 },
  category: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.3, marginTop: 22 },
  itemName: { color: '#202124', fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  itemMeta: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  primaryButton: { width: '100%', minHeight: 50, borderRadius: 16, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 24 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 30, marginBottom: 12 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionHint: { color: '#747985', fontSize: 12 },
  pickCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 13, marginBottom: 10 },
  myPickCard: { backgroundColor: '#F1F0FF', borderColor: '#B9B5F5' },
  myReviewLabel: { color: '#4945ED', fontSize: 12, fontWeight: '800', marginBottom: 4 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  pickCopy: { flex: 1, marginLeft: 12 },
  username: { color: '#202124', fontSize: 12, fontWeight: '800' },
  review: { color: '#5F6470', fontSize: 12, lineHeight: 18, marginTop: 5 },
  profileLink: { minHeight: 44, justifyContent: 'center' },
  reviewLink: { minHeight: 44, justifyContent: 'center' },
  pickAction: { color: '#4945ED', fontSize: 12, marginTop: 7 },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  centerState: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: '#202124', fontSize: 20, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  secondaryButton: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 17 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
