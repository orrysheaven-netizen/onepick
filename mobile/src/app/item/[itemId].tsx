import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useAttachItemPhoto, useChoosePhoto, useMyPendingItemPhoto, useRevisePendingItem } from '@/hooks/useRegisterPick';
import { useReadNotificationGroup } from '@/hooks/useNotifications';
import { ItemChannelLinks } from '@/components/item-channel-links';
import { ItemPickCount } from '@/components/item-pick-count';
import { ItemReviewCard } from '@/components/item-review-card';
import { YouTubeVideoLink } from '@/components/youtube-video-link';
import { PickPhoto } from '@/components/pick-photo';
import { Button, Icon, StateCard } from '@/components/ui';
import type { PickPhotoDraft } from '@/types/domain/photo';
import { showPhotoFailure } from '@/lib/photos/photoFailure';
import { categoryWithChannels, homeChannelLabel } from '@/lib/home/homeChannels';
import { itemTitle } from '@/lib/items/itemTitle';
import { consumePickSavedToast } from '@/lib/items/pickSavedToast';
import { isNaverMapUrl } from '@/services/storeFirstService';
import { observabilityService } from '@/services';
import type { Item } from '@/types/domain/item';
import { OnePick, OnePickFeatures, OnePickMvp, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

function photoErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'PHOTO_INVALID': return '이미지를 읽지 못했어요. 다른 사진을 선택해주세요.';
      case 'PHOTO_TOO_LARGE': return '사진이 서버의 최대 저장 용량을 초과했어요. 다른 사진을 선택해주세요.';
      case 'PHOTO_UPLOAD_FAILED': return '사진 파일은 정상적으로 읽었지만 서버 저장에 실패했어요. 잠시 후 다시 시도해주세요.';
      case 'ITEM_NOT_ELIGIBLE': return '지금은 여기에 이미지를 추가할 수 없어요.';
      case 'AUTH_REQUIRED': return '로그인 상태를 다시 확인해주세요.';
      case 'PROFILE_NOT_FOUND': return '사용자명을 먼저 정해주세요.';
    }
  }
  return '대표 이미지를 추가하지 못했어요. 잠시 후 다시 시도해주세요.';
}

function revisionErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'ITEM_LINK_REQUIRED' || error.code === 'LINK_INVALID') {
      return '네이버 지도 링크를 확인해주세요.';
    }
    if (error.code === 'PLACE_ALREADY_REGISTERED') {
      return '같은 이름과 링크로 등록 요청된 매장이 이미 있어요. 링크를 다시 확인해주세요.';
    }
    if (error.code === 'ITEM_NOT_FOUND' || error.code === 'ITEM_NOT_ELIGIBLE') {
      return '지금은 이 요청을 수정할 수 없어요.';
    }
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인해주세요.';
    if (error.code === 'PHOTO_INVALID' || error.code === 'PHOTO_TOO_LARGE' || error.code === 'PHOTO_UPLOAD_FAILED') {
      return photoErrorMessage(error);
    }
  }
  return '수정 내용을 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
}

type Params = {
  itemId?: string;
  pickId?: string;
  photo?: string;
  notificationGroupId?: string;
  notificationSnapshot?: string;
  notificationKind?: string;
  notificationReason?: string;
  rootCommentId?: string;
  commentAfterTime?: string;
  commentAfterId?: string;
};
export default function ItemDetailScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  if ((params.notificationKind === 'comment' || params.notificationKind === 'reply') && typeof params.pickId === 'string') {
    return <Redirect href={{ pathname: '/pick/[pickId]', params: {
      pickId: params.pickId,
      ...(typeof params.itemId === 'string' ? { itemId: params.itemId } : {}),
      ...(typeof params.notificationGroupId === 'string' ? { notificationGroupId: params.notificationGroupId } : {}),
      ...(typeof params.notificationSnapshot === 'string' ? { notificationSnapshot: params.notificationSnapshot } : {}),
      ...(typeof params.notificationKind === 'string' ? { notificationKind: params.notificationKind } : {}),
      ...(typeof params.rootCommentId === 'string' ? { rootCommentId: params.rootCommentId } : {}),
      ...(typeof params.commentAfterTime === 'string' ? { commentAfterTime: params.commentAfterTime } : {}),
      ...(typeof params.commentAfterId === 'string' ? { commentAfterId: params.commentAfterId } : {}),
    } }} />;
  }
  // A file selected for one item/account must never be submitted for another.
  return <ItemDetailContent key={`${auth.user?.id ?? 'anonymous'}:${params.itemId ?? ''}`} auth={auth} params={params} />;
}

function ItemDetailContent({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
  const focusPickId = typeof params.pickId === 'string' ? params.pickId : undefined;
  const notificationGroupId = typeof params.notificationGroupId === 'string' ? params.notificationGroupId : undefined;
  const notificationSnapshot = typeof params.notificationSnapshot === 'string' ? params.notificationSnapshot : undefined;
  const notificationKind = typeof params.notificationKind === 'string' ? params.notificationKind : undefined;
  const notificationReason = typeof params.notificationReason === 'string' ? params.notificationReason : undefined;
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = auth;
  const publicFoodChannel = OnePickFeatures.foodChannelPicker ? undefined : OnePickMvp.publicPickChannel;
  const query = useItemDetail(itemId, user?.id, focusPickId, true, !isSessionLoading && !sessionError, publicFoodChannel);
  const readNotificationGroup = useReadNotificationGroup(user?.id);
  const revisionMutation = useRevisePendingItem();
  const trackedItemId = useRef<string | undefined>(undefined);
  const acknowledgedNotification = useRef<string | undefined>(undefined);
  // A one-shot registration handoff reveals the final detail before any toast.
  // Shared links, refreshes and other item visits cannot replay the completion UI.
  const [arrivedFromRegistration] = useState(() => consumePickSavedToast(focusPickId));
  const [completionPending, setCompletionPending] = useState(arrivedFromRegistration);
  const [pickSavedToast, setPickSavedToast] = useState(false);
  useEffect(() => {
    if (!pickSavedToast) return;
    const timer = setTimeout(() => setPickSavedToast(false), 2000);
    return () => clearTimeout(timer);
  }, [pickSavedToast]);

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

  useEffect(() => {
    if (!user || !query.data || !notificationGroupId || !notificationSnapshot) return;
    const receipt = `${notificationGroupId}:${notificationSnapshot}`;
    if (acknowledgedNotification.current === receipt) return;
    acknowledgedNotification.current = receipt;
    void readNotificationGroup.mutateAsync({ groupId: notificationGroupId, snapshot: notificationSnapshot })
      .catch(() => {
        if (acknowledgedNotification.current === receipt) acknowledgedNotification.current = undefined;
      });
  }, [notificationGroupId, notificationSnapshot, query.data?.item.id, user?.id]);

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
    if (!arrivedFromRegistration && params.photo !== '1' && focusPickId && reviewPositions.current[focusPickId] !== undefined) {
      focusReview(focusPickId);
      scrolledTo.current = focusPickId;
    }
  }, [arrivedFromRegistration, focusPickId, focusReview, user?.id, params.photo]);
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
  const [revisionPhoto, setRevisionPhoto] = useState<PickPhotoDraft | null>(null);
  const [revisionLink, setRevisionLink] = useState('');
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [savedItem, setSavedItem] = useState<Item | null>(null);
  const currentItem = savedItem ?? query.data?.item;
  const hasPhoto = Boolean(currentItem?.imagePath || currentItem?.imageUrl || currentItem?.thumbnailUrl || currentItem?.imageSourceUrl);
  const photoSlotOpen = Boolean(itemId && !query.isError && currentItem && ['active', 'discontinued'].includes(currentItem.status) && !hasPhoto);
  // L4: my photo waiting for admin review is shown to me only, in place of the upload row.
  const myPendingPhoto = useMyPendingItemPhoto(itemId, user?.id, photoSlotOpen);
  const pendingPhoto = photoSlotOpen ? myPendingPhoto.data ?? null : null;
  const canContribute = photoSlotOpen && !pendingPhoto && !(Boolean(user) && myPendingPhoto.isPending);
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
  const chooseRevisionPhoto = async () => {
    if (!user || photoPicker.isPending || revisionMutation.isPending) return;
    setRevisionError(null);
    try {
      const selected = await photoPicker.mutateAsync();
      if (selected) setRevisionPhoto(selected);
    } catch (error) {
      setRevisionError(photoErrorMessage(error));
    }
  };

  const saveRevision = async () => {
    if (!user || !itemId || revisionMutation.isPending || photoPicker.isPending) return;
    const link = revisionLink.trim();
    if (link && !isNaverMapUrl(link)) {
      setRevisionError('네이버 지도 링크를 확인해주세요.');
      return;
    }
    if (!link && !revisionPhoto) {
      setRevisionError('수정할 지도 링크나 사진을 입력해주세요.');
      return;
    }
    setRevisionError(null);
    try {
      await revisionMutation.mutateAsync({
        userId: user.id,
        itemId,
        linkUrl: link || undefined,
        photo: revisionPhoto,
      });
      router.replace('/');
    } catch (error) {
      setRevisionError(revisionErrorMessage(error));
    }
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
      <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요." action={{ label: '다시 확인하기', variant: 'secondary', onPress: retrySession }} />
    </View></SafeAreaView>;
  }

  if (isSessionLoading || (Boolean(itemId) && query.isPending && !savedItem)) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <StateCard loading title="정보를 불러오고 있어요." />
        </View>
      </SafeAreaView>
    );
  }

  // A failed background refetch keeps the last data (react-query v5 sets isError with data);
  // only a failure with nothing to show replaces the screen.
  if (!itemId || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <StateCard tone={savedItem ? 'default' : 'danger'} title={savedItem ? '사진 등록 요청을 처리했어요.' : '정보를 볼 수 없어요.'}
            text={savedItem
              ? '서버의 처리 응답은 받았지만 최신 정보를 확인하지 못했어요. 다시 불러와 현재 사진을 확인해주세요.'
              : '연결 상태를 확인한 뒤 다시 시도해주세요. 없어졌거나 공개되지 않은 링크일 수도 있어요.'}
            action={itemId ? { label: query.isFetching ? '다시 불러오는 중…' : '정보 다시 불러오기', accessibilityLabel: '정보 다시 불러오기', variant: 'secondary', disabled: query.isFetching, onPress: () => void retryItem() } : undefined} />
          <Button variant="ghost" label="돌아가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.centered} />
        </View>
      </SafeAreaView>
    );
  }

  const { category, brand, isRestaurant, myPickStatus, pickChannel, picks: allPicks, canChoose } = query.data;
  const item = savedItem ?? query.data.item;
  const mvpFoodScope = isRestaurant && !OnePickFeatures.foodChannelPicker;
  // Legacy food items may have no item_channels row, while an explicit Pick
  // channel is still valid by the DB contract. If a current public offline Pick
  // reached Home/Profile, its item detail must stay reachable too.
  const hasCurrentPick = allPicks.some(({ pick }) =>
    pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review'));
  const hasOwnCurrentPick = Boolean(user && allPicks.some(({ pick }) =>
    pick.userId === user.id
    && (pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review'))));
  const hasPublicCurrentPick = allPicks.some(({ pick }) =>
    pick.channel === OnePickMvp.publicPickChannel
    && (pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review')));
  const itemSupportsPublicChannel = !mvpFoodScope
    || item.channels?.includes(OnePickMvp.publicPickChannel)
    || item.externalSource === 'onepick_place'
    || hasPublicCurrentPick;
  const picks = mvpFoodScope
    ? allPicks.filter(({ pick }) => pick.channel === OnePickMvp.publicPickChannel
      || (!pick.channel && itemSupportsPublicChannel))
    : allPicks;
  const focusAvailable = !focusPickId || picks.some(({ pick }) => pick.id === focusPickId);
  const displayChannels = mvpFoodScope ? [OnePickMvp.publicPickChannel] : item.channels;
  if (!itemSupportsPublicChannel) {
    return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><View style={styles.centerState}>
      <StateCard title="현재 공개 중인 원픽이 아니에요." text="지금은 매장에서 고른 음식 원픽만 공개하고 있어요." />
      <Button variant="ghost" label="홈으로" onPress={() => router.replace('/')} style={styles.centered} />
    </View></SafeAreaView>;
  }
  if (!hasPhoto && hasCurrentPick && !hasOwnCurrentPick) {
    return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}><View style={styles.centerState}>
      <StateCard title="현재 공개 중인 원픽이 아니에요." text="사진이 있는 원픽만 공개하고 있어요." />
      <Button variant="ghost" label="홈으로" onPress={() => router.replace('/')} style={styles.centered} />
    </View></SafeAreaView>;
  }
  const credit = query.photoCredit && query.photoCredit.itemId === item.id && query.photoCredit.imagePath === item.imagePath
    && query.photoCredit.imageSourceUrl === (item.imageSourceUrl ?? null) ? query.photoCredit : null;
  const openPickAction = () => {
    if (!canChoose) return;
    router.push({ pathname: '/pick/choose', params: { itemId: item.id, categoryId: item.categoryId, ...(pickChannel ? { channel: pickChannel } : {}) } });
  };
  const completeRegistration = () => {
    if (!completionPending) return;
    setCompletionPending(false);
    setPickSavedToast(true);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView ref={scroll} style={styles.detailScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel={arrivedFromRegistration ? '홈으로 이동' : '뒤로 가기'}
          onPress={() => arrivedFromRegistration ? router.replace('/') : router.canGoBack() ? router.back() : router.replace('/')}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Icon name={arrivedFromRegistration ? 'home' : 'back'} />
        </Pressable>

        {query.isError ? <StateCard compact tone="danger" accessibilityRole="alert" title="최신 정보를 불러오지 못했어요." text="마지막으로 불러온 내용을 표시하고 있어요."
          action={{ label: query.isFetching ? '다시 불러오는 중…' : '다시 불러오기', disabled: query.isFetching, onPress: () => void retryItem() }} /> : null}

        {notificationKind === 'fix_needed' ? <View style={styles.revisionPanel}>
          <Text style={styles.revisionTitle}>수정이 필요해요.</Text>
          <Text style={styles.revisionText}>{notificationReason || '등록한 매장 정보를 확인하고 필요한 부분을 수정해주세요.'}</Text>
          <TextInput
            accessibilityLabel="수정할 네이버 지도 링크"
            autoCapitalize="none"
            keyboardType="url"
            value={revisionLink}
            onChangeText={(value) => { setRevisionLink(value); setRevisionError(null); }}
            placeholder="새 네이버 지도 링크가 있으면 입력"
            placeholderTextColor={OnePick.textSecondary}
            style={styles.revisionInput}
          />
          {revisionPhoto ? <Image source={{ uri: revisionPhoto.uri }} style={styles.revisionPreview} resizeMode="contain" accessibilityLabel="수정할 대표 이미지 미리보기" /> : null}
          <View style={styles.revisionActions}>
            <Button variant="secondary" label={revisionPhoto ? '다른 사진 고르기' : '사진 바꾸기'} loading={photoPicker.isPending}
              disabled={revisionMutation.isPending} onPress={() => void chooseRevisionPhoto()} style={styles.revisionAction} />
            <Button label="수정 내용 보내기" loading={revisionMutation.isPending}
              disabled={photoPicker.isPending} onPress={() => void saveRevision()} style={styles.revisionAction} />
          </View>
          {revisionError ? <Text accessibilityRole="alert" style={styles.photoError}>{revisionError}</Text> : null}
        </View> : null}

        <View style={styles.heroCard}>
          {/* No photo yet: a one-line upload row instead of an empty square. */}
          {hasPhoto || !canContribute ? <PickPhoto uri={item.imageUrl ?? item.thumbnailUrl ?? item.imageSourceUrl ?? pendingPhoto?.imageUrl} label={item.name} large={hasPhoto || Boolean(pendingPhoto)} logoUri={brand?.logoUrl} /> : null}
          {pendingPhoto ? <Text accessibilityLiveRegion="polite" style={styles.photoContributionHint}>내가 올린 사진이에요. 관리자 검수 후 같은 걸 고른 사람들에게도 보여요. 지금은 나에게만 보여요.</Text> : null}
          {credit ? <Pressable accessibilityRole="button" accessibilityLabel={`사진 등록자 @${credit.username} 프로필 보기`}
            onPress={() => router.push({ pathname: '/u/[username]', params: { username: credit.username, returnTo: `/item/${item.id}` } })} style={styles.creditLink}>
            <Text style={styles.creditText}>사진 @{credit.username}</Text>
          </Pressable> : null}
          {photoAcknowledged.current && credit && credit.userId === user?.id ?
            <Text accessibilityLiveRegion="polite" style={styles.photoContributionHint}>사진을 보태주셨어요. 같은 원픽을 고른 사람들도 이 사진을 함께 사용해요.</Text> : null}
          {canContribute ? (
            <View style={styles.photoContribution}>
              {photo ? (
                <>
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" />
                  <Text style={styles.photoContributionHint}>올린 사진은 관리자 검수 후 같은 걸 고른 사람들의 카드에 내 사용자명과 함께 표시돼요.</Text>
                  <View style={styles.photoActions}>
                    <Button variant="secondary" label="다른 사진 고르기" disabled={photoBusy} onPress={() => void choosePhoto()} style={styles.photoAction} />
                    <Button label="이 사진 등록하기" disabled={photoBusy && !photoAttachment.isPending} loading={photoAttachment.isPending} onPress={() => void attachPhoto()} style={styles.photoAction} />
                  </View>
                  <Button variant="ghost" size="sm" label="사진 빼기" disabled={photoBusy} onPress={() => { setPhoto(null); photoAttachment.reset(); }} style={styles.centered} />
                </>
              ) : (
                <View style={styles.uploadRow}>
                  <Text numberOfLines={1} style={styles.uploadText}>사진을 올려주세요.</Text>
                  <Button size="sm" label="사진 올리기" accessibilityLabel={`${item.name} 사진 올리기`}
                    disabled={Boolean(user) && photoBusy && !photoPicker.isPending} loading={photoPicker.isPending}
                    onPress={() => user ? void choosePhoto() : router.push({ pathname: '/auth/login', params: photoIntent })} />
                </View>
              )}
              {user ? <>
              {photoPicker.isError ? <Text accessibilityRole="alert" style={styles.photoError}>{photoErrorMessage(photoPicker.error)}</Text> : null}
              {photoAttachment.isError ? <Text accessibilityRole="alert" style={styles.photoError}>{photoErrorMessage(photoAttachment.error)}</Text> : null}
              {photoAttachment.error instanceof AppError && photoAttachment.error.code === 'PROFILE_NOT_FOUND' ?
                <Button variant="secondary" size="sm" label="사용자명 만들고 계속하기" onPress={() => router.push({ pathname: '/auth/username', params: photoIntent })} style={styles.photoRecovery} /> : null}
              {photoAttachment.error instanceof AppError && photoAttachment.error.code === 'AUTH_REQUIRED' ?
                <Button variant="secondary" size="sm" label="다시 로그인하고 계속" onPress={() => router.push({ pathname: '/auth/login', params: photoIntent })} style={styles.photoRecovery} /> : null}
              </> : null}
            </View>
          ) : null}
          {/* Restaurants name the menu in the title (중앙해장 내장탕); only the channel stays above it. */}
          {isRestaurant
            ? homeChannelLabel(displayChannels) ? <Text style={styles.category}>{homeChannelLabel(displayChannels)}</Text> : null
            : category?.name ? <Text style={styles.category}>{categoryWithChannels(category.name, item.channels)}</Text> : null}
          {brand ? <View style={styles.brandRow}>
            {brand.logoUrl ? <View style={styles.brandLogo}>
              <Image source={{ uri: brand.logoUrl }} style={styles.brandLogoImage} resizeMode="contain" accessibilityLabel={`${brand.name} 로고`} />
            </View> : null}
            <Text numberOfLines={1} style={styles.brandName}>{brand.name}</Text>
          </View> : null}
          <Text style={styles.itemName}>{itemTitle(item.name, category?.name, isRestaurant)}</Text>
          <YouTubeVideoLink item={item} />
          {!mvpFoodScope ? <ItemPickCount itemId={item.id} /> : null}
          {!mvpFoodScope ? <ItemChannelLinks itemId={item.id} /> : null}

          {/* One shape for the Pick state: filled brand color when it is my Pick, no color
              otherwise. My own Pick is edited on its review card below, so it is not pressable. */}
          {myPickStatus.type === 'selected_this' ? (
            <View accessible accessibilityLabel="내 원픽이에요" style={[styles.pickMark, styles.pickMarkMine]}>
              <View style={[styles.pickDot, styles.pickDotMine]}><Icon name="check" size="sm" color={OnePick.bgAccent} /></View>
              <Text style={[styles.pickMarkText, styles.pickMarkTextMine]}>원픽</Text>
            </View>
          ) : canChoose ? (
            <Pressable accessibilityRole="button" onPress={openPickAction}
              accessibilityLabel={myPickStatus.type === 'selected_other' ? '원픽 바꾸기' : '원픽으로 고르기'}
              style={({ pressed }) => [styles.pickMark, pressed && styles.pressed]}>
              <View style={styles.pickDot} />
              <Text style={styles.pickMarkText}>원픽</Text>
            </Pressable>
          ) : <Text style={styles.itemMeta}>지금은 여기서 새 원픽을 선택할 수 없어요.</Text>}
        </View>

        <View style={styles.sectionGap} />

        {focusPickId && !focusAvailable ? <Text style={styles.stateText}>연결된 한줄평이 삭제됐거나 현재 공개 범위에 없어요.</Text> : null}
        {picks.length > 0 ? (
          picks.map(({ pick, profile }) => (
            <View key={`${user?.id ?? 'public'}:${pick.id}`} onLayout={(event) => {
              reviewPositions.current[pick.id] = event.nativeEvent.layout.y;
              if (!arrivedFromRegistration && params.photo !== '1' && pick.id === focusPickId && scrolledTo.current !== focusPickId) {
                focusReview(pick.id);
                scrolledTo.current = pick.id;
              }
            }}>
              <ItemReviewCard pick={pick} profile={profile} categoryName={category?.name ?? '이 메뉴'}
                itemName={item.name} itemId={item.id} highlighted={pick.id === highlightedId}
                onRemoved={() => { router.setParams({ pickId: undefined }); void query.refetch(); }} />
            </View>
          ))
        ) : (
          <StateCard title={canChoose ? '첫 한줄평을 남겨보세요.' : '아직 한줄평이 없어요.'} text={canChoose ? '이 메뉴를 원픽으로 고르면 한줄평을 남길 수 있어요.' : '지금은 새 원픽을 받을 수 없어요.'} />
        )}
      </ScrollView>
      {completionPending ? <View style={styles.completionFooter}>
        <Button label="완료" fullWidth onPress={completeRegistration} accessibilityLabel="원픽 등록 완료" />
      </View> : null}
      {pickSavedToast ? <View pointerEvents="none" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.toastOverlay}>
        <View style={styles.toast}>
          <Text style={styles.toastText}>원픽을 등록했어요.</Text>
        </View>
      </View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.bgDefault },
  content: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingBottom: OnePickSpace.xxxl + OnePickSpace.lg,
  },
  detailScroll: { flex: 1 },
  completionFooter: {
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    paddingVertical: OnePickSpace.sm,
    backgroundColor: OnePick.bgDefault,
  },
  centered: { alignSelf: 'center' },
  toastOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toast: {
    minHeight: 60,
    minWidth: 220,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: OnePick.textPrimary,
    borderRadius: OnePickRadius.lg,
    paddingHorizontal: OnePickSpace.xl,
    paddingVertical: OnePickSpace.md,
  },
  toastText: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: OnePickSpace.xs,
    marginLeft: -OnePickSpace.sm,
  },
  revisionPanel: {
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    borderRadius: OnePickRadius.lg,
    backgroundColor: OnePick.bgAccentSubtle,
    padding: OnePickSpace.lg,
    marginBottom: OnePickSpace.md,
  },
  revisionTitle: { ...OnePickType.headline, color: OnePick.textPrimary },
  revisionText: { ...OnePickType.body, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  revisionInput: {
    ...OnePickType.body,
    minHeight: 48,
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgDefault,
    color: OnePick.textPrimary,
    paddingHorizontal: OnePickSpace.md,
    marginTop: OnePickSpace.md,
  },
  revisionPreview: {
    width: '100%',
    height: 180,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgSubtle,
    marginTop: OnePickSpace.md,
  },
  revisionActions: { flexDirection: 'row', gap: OnePickSpace.sm, marginTop: OnePickSpace.md },
  revisionAction: { flex: 1 },
  heroCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    backgroundColor: OnePick.bgDefault,
    borderRadius: OnePickRadius.lg,
    padding: OnePickSpace.xxl,
    marginTop: OnePickSpace.sm,
  },
  creditLink: {
    alignSelf: 'flex-end',
    minHeight: 24,
    justifyContent: 'center',
    marginTop: -OnePickSpace.md,
    paddingHorizontal: OnePickSpace.xs,
  },
  creditText: { ...OnePickType.caption, color: OnePick.textSecondary },
  photoContribution: { width: '100%' },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: OnePick.borderDefault,
    borderRadius: OnePickRadius.md,
    paddingVertical: OnePickSpace.sm,
    paddingLeft: OnePickSpace.md,
    paddingRight: OnePickSpace.sm,
  },
  uploadText: { ...OnePickType.body, flex: 1, color: OnePick.textSecondary },
  photoContributionHint: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  photoPreview: {
    width: '100%',
    height: 210,
    borderRadius: OnePickRadius.lg,
    backgroundColor: OnePick.bgSubtle,
    marginTop: OnePickSpace.md,
  },
  photoActions: {
    flexDirection: 'row',
    gap: OnePickSpace.sm,
    marginTop: OnePickSpace.md,
    marginBottom: OnePickSpace.xs,
  },
  photoAction: { flex: 1 },
  photoRecovery: { marginTop: OnePickSpace.sm },
  photoError: { ...OnePickType.caption, color: OnePick.textDanger, marginTop: OnePickSpace.sm },
  category: { ...OnePickType.captionMedium, color: OnePick.textSecondary, marginTop: OnePickSpace.xl },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: OnePickSpace.sm,
    marginTop: OnePickSpace.sm,
  },
  brandLogo: {
    width: 24,
    height: 24,
    borderRadius: OnePickRadius.full,
    padding: OnePickSpace.xs,
    overflow: 'hidden',
    backgroundColor: OnePick.bgDefault,
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
  },
  brandLogoImage: { width: '100%', height: '100%' },
  brandName: { ...OnePickType.bodyMedium, color: OnePick.textSecondary, flexShrink: 1 },
  itemName: { ...OnePickType.pageTitle, color: OnePick.textPrimary, textAlign: 'center', marginTop: OnePickSpace.sm },
  itemMeta: { ...OnePickType.caption, color: OnePick.textSecondary, textAlign: 'center', marginTop: OnePickSpace.sm },
  pickMark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: OnePickSpace.sm,
    alignSelf: 'center',
    minWidth: 140,
    minHeight: 48,
    borderRadius: OnePickRadius.full,
    borderWidth: 1,
    borderColor: OnePick.borderDefault,
    backgroundColor: OnePick.bgDefault,
    paddingHorizontal: OnePickSpace.xxl,
    marginTop: OnePickSpace.xl,
  },
  pickMarkMine: { backgroundColor: OnePick.bgAccent, borderColor: OnePick.bgAccent },
  pickDot: {
    width: 22,
    height: 22,
    borderRadius: OnePickRadius.full,
    borderWidth: 2,
    borderColor: OnePick.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickDotMine: { borderColor: OnePick.textPrimary, backgroundColor: OnePick.textPrimary },
  pickMarkText: { ...OnePickType.headline, color: OnePick.textPrimary },
  pickMarkTextMine: { color: OnePick.textPrimary },
  sectionGap: { height: OnePickSpace.xl },
  centerState: {
    flex: 1,
    width: '100%',
    maxWidth: OnePick.maxWidth,
    alignSelf: 'center',
    justifyContent: 'center',
    gap: OnePickSpace.md,
    paddingHorizontal: OnePickSpace.gutter,
  },
  stateText: { ...OnePickType.body, color: OnePick.textSecondary, textAlign: 'center', marginTop: OnePickSpace.sm },
  pressed: { opacity: 0.7 },
});
