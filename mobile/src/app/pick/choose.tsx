import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhoto } from '@/components/pick-photo';
import { PickPhotoStep } from '@/components/pick-photo-step';
import { BrandMark, Button, Icon, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useChoosePick } from '@/hooks/useChoosePick';
import { useRegisterItemPick } from '@/hooks/useRegisterPick';
import { useItemDetail } from '@/hooks/useItemDetail';
import { channelLabel } from '@/lib/home/homeChannels';
import { parseChannelParam } from '@/lib/items/pickChannel';
import type { Item } from '@/types/domain/item';
import type { Pick } from '@/types/domain/pick';
import { OnePick, OnePickFeatures, OnePickMvp } from '@/constants/onepick';

function getErrorMessage(error: unknown) {
  if (!(error instanceof AppError)) return '원픽을 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
  switch (error.code) {
    case 'AUTH_REQUIRED': return '로그인이 만료됐거나 확인되지 않았어요. 다시 로그인한 뒤 선택을 이어가주세요.';
    case 'PROFILE_NOT_FOUND': return '원픽을 남기려면 사용자명을 먼저 정해주세요.';
    case 'CATEGORY_NOT_PICKABLE': return '지금은 이 카테고리에서 원픽을 고를 수 없어요.';
    case 'ITEM_NOT_ELIGIBLE':
    case 'ITEM_NOT_FOUND': return '지금은 이걸 원픽으로 고를 수 없어요.';
    case 'ITEM_CATEGORY_MISMATCH': return '카테고리 정보가 맞지 않아요.';
    case 'REVIEW_INVALID': return '한줄평을 1~100자로 입력해주세요.';
    case 'PICK_CONFLICT': return '원픽 상태가 바뀌었어요. 다시 시도해주세요.';
    case 'PICK_CHANGED_ELSEWHERE': return '다른 기기에서 원픽이 바뀌었어요. 기존 원픽은 변경하지 않았어요.';
    case 'PICK_COOLDOWN': return '해제한 원픽은 24시간이 지나야 다시 고를 수 있어요.';
    case 'ITEM_ALREADY_PICKED': return '이미 다른 방식의 원픽으로 고른 곳이에요. 그 원픽을 먼저 바꾸거나 지워주세요.';
    case 'PICK_CHANNEL_MISMATCH': return '이 방식으로는 이걸 원픽으로 고를 수 없어요.';
    default: return '원픽을 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { itemId?: string; categoryId?: string; channel?: string; returnPickId?: string };
type PickReceipt = { id: string; itemId: string; userId: string; oneLineReview: string };
type SavedChoice = { pick: Pick | PickReceipt; item: Item; published?: boolean };

export default function ChoosePickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  // A saved result and its draft belong to one account/product only. Pending
  // requests from an unmounted form cannot populate the next account's result.
  return <ChoosePickForm key={`${auth.user?.id ?? 'anonymous'}:${params.itemId ?? ''}:${params.categoryId ?? ''}:${params.channel ?? ''}`} auth={auth} params={params} />;
}

function ChoosePickForm({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = auth;
  const routeChannel = parseChannelParam(params.channel);
  const requestedChannel = routeChannel && !OnePickFeatures.foodChannelPicker ? OnePickMvp.publicPickChannel : routeChannel;
  const itemQuery = useItemDetail(params.itemId, user?.id, undefined, false, true, requestedChannel);
  const choosePick = useChoosePick();
  const registerCommentPick = useRegisterItemPick();
  const saving = choosePick.isPending || registerCommentPick.isPending;
  const saveError = choosePick.error ?? registerCommentPick.error;
  const [draftReview, setReview] = useState<string | null>(null);
  // null means "not touched on this screen". The stored link is not read back
  // here yet, so an untouched field must send nothing rather than an empty
  // string, or editing only the review would wipe a link saved earlier.
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [draftTip, setDraftTip] = useState<string | null>(null);
  const [tipAnswer, setTipAnswer] = useState<'unanswered' | 'yes' | 'no'>('unanswered');
  const [savedChoice, setSavedChoice] = useState<SavedChoice | null>(null);
  const [showReviewError, setShowReviewError] = useState(false);
  const [commentPickError, setCommentPickError] = useState<string | null>(null);
  const [photoOfferSkipped, setPhotoOfferSkipped] = useState(false);
  // The item as returned by a photo saved in step 1; keeps the new photo on
  // screen even before the detail query refreshes.
  const [photoItem, setPhotoItem] = useState<Item | null>(null);
  const photoOfferClosed = useRef(false);
  const reviewInput = useRef<TextInput>(null);
  // Mutation state arrives on a later render. A synchronous phase also guards
  // same-frame double taps and old event handlers after an acknowledged save.
  const submitPhase = useRef<'idle' | 'saving' | 'saved'>('idle');
  // Reuse the same ID when a comment-originated registration response is lost.
  // The keyed form resets this on account/item changes.
  const commentRequestId = useRef<string | null>(null);
  // Preserve the acknowledged result even if a later detail refresh fails.
  // Navigation uses the returned Pick IDs, never a potentially stale myPickStatus.
  const loadedItem = itemQuery.data?.item;
  const item = savedChoice?.item ?? (photoItem && photoItem.id === loadedItem?.id ? photoItem : loadedItem);
  const pickStatus = itemQuery.data?.myPickStatus;
  // Food menus keep one Pick per channel (오프라인 맛집 / 온라인 맛집 / 레시피).
  const pickChannel = itemQuery.data?.pickChannel ?? null;
  const review = draftReview ?? (pickStatus?.type === 'selected_this' ? pickStatus.oneLineReview : '');
  const canChoose = itemQuery.data?.canChoose ?? false;
  // Pending requests are not Pick targets. After review the member explicitly
  // chooses the approved item; approval never creates a new Pick from this screen.
  const isOwnRequest = Boolean(user && item && item.status === 'pending' && item.createdBy === user.id);
  const canSubmit = canChoose;
  const trimmedReview = review.trim();
  const trimmedUrl = (draftUrl ?? '').trim();
  const trimmedTip = (draftTip ?? '').trim();
  const hasUrlDraft = trimmedUrl.length > 0;
  const isValidUrl = !OnePickFeatures.purchaseLinks || !hasUrlDraft || (trimmedUrl.length <= 2048 && /^https:\/\/[^\s]+$/.test(trimmedUrl));
  const showTipQuestion = hasUrlDraft && isValidUrl;
  const showTipInput = showTipQuestion && tipAnswer === 'yes';
  const isValidReview = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const hasReviewError = showReviewError && !isValidReview;
  const routeMatchesItem = !item || !params.categoryId || item.categoryId === params.categoryId;
  // Only a valid return ID identifies the comment-originated flow.
  const returnPickId = typeof params.returnPickId === 'string' && UUID_PATTERN.test(params.returnPickId) ? params.returnPickId : null;
  // The existing atomic registration RPC currently supports food items only.
  // Do not change the regular /pick/choose behavior or unlaunched channels.
  const atomicCommentRegistration = Boolean(returnPickId && itemQuery.data?.isRestaurant
    && pickChannel === OnePickMvp.publicPickChannel && !OnePickFeatures.purchaseLinks);
  const formTitle = pickStatus?.type === 'selected_other' ? '원픽을 바꿀까요?'
    : pickStatus?.type === 'selected_this' ? '한줄평을 고쳐볼까요?' : '이걸 내 원픽으로 정할까요?';
  const submitLabel = useMemo(() => {
    if (pickStatus?.type === 'selected_other') return '원픽 바꾸기';
    if (pickStatus?.type === 'selected_this') return '한줄평 저장하기';
    return '내 원픽으로 고르기';
  }, [pickStatus]);

  const handleSubmit = async () => {
    if (submitPhase.current === 'saving' || submitPhase.current === 'saved'
      || saving || savedChoice || isSessionLoading || sessionError) return;
    // No pick without a photo: the button stays disabled until step 1 saves one.
    if (needsPhotoStep) return;
    if (!isValidReview) { setShowReviewError(true); reviewInput.current?.focus(); return; }
    if (!isValidUrl) return;
    if (!user || !item || !canSubmit || itemQuery.isError || !routeMatchesItem) return;
    submitPhase.current = 'saving';
    try {
      // Only the existing food/offline registration RPC enforces expected-null
      // atomically. A last-moment read is a UX preflight, not the safety boundary.
      // On a lost response the retained request ID makes retry idempotent.
      if (returnPickId && !commentRequestId.current) {
        const latest = await itemQuery.refetch();
        if (latest.isError || !latest.data) {
          setCommentPickError('원픽 상태를 확인하지 못했어요. 다시 시도해주세요.');
          return;
        }
        if (latest.data.myPickStatus.type !== 'not_selected') {
          setCommentPickError('원픽 상태가 바뀌었어요. 기존 원픽은 변경하지 않았어요. 댓글 화면으로 돌아가주세요.');
          return;
        }
      }
      setCommentPickError(null);
      if (atomicCommentRegistration) {
        const requestId = commentRequestId.current ?? Crypto.randomUUID();
        commentRequestId.current = requestId;
        const result = await registerCommentPick.mutateAsync({
          userId: user.id,
          categoryId: item.categoryId,
          channel: OnePickMvp.publicPickChannel,
          oneLineReview: trimmedReview,
          itemId: item.id,
          expectedPreviousPickId: null,
          requestId,
        });
        // register_item_pick returns an ID receipt, not a full Pick row.
        setSavedChoice({
          pick: { id: result.pickId, itemId: result.itemId, userId: user.id, oneLineReview: trimmedReview },
          item,
          published: result.published,
        });
      } else {
        // Non-food or future channels retain their existing choice contract.
        // #770 must not release them without a separate atomic safeguard review.
        const result = await choosePick.mutateAsync({
          categoryId: item.categoryId, itemId: item.id, oneLineReview: trimmedReview,
          ...(pickChannel ? { channel: pickChannel } : {}),
          // An untouched field is left out so the stored value survives; '' clears it.
          ...(OnePickFeatures.purchaseLinks && draftUrl !== null ? { purchaseUrl: trimmedUrl } : {}),
          ...(draftUrl === null && draftTip === null ? {}
            : { purchaseTip: showTipInput ? trimmedTip : '' }),
        });
        setSavedChoice({ pick: result, item });
      }
      submitPhase.current = 'saved';
    } catch { /* Mutation state renders the error; no success route is exposed. */ }
    finally { if (submitPhase.current === 'saving') submitPhase.current = 'idle'; }
  };
  const goBack = () => {
    if (submitPhase.current === 'saving' || saving) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const retryItem = () => {
    if (params.itemId && !itemQuery.isFetching) void itemQuery.refetch();
  };
  const openRecovery = (needsUsername: boolean) => {
    if (!item || !routeMatchesItem || isSessionLoading || sessionError || submitPhase.current === 'saving' || saving) return;
    // Pass only the existing validated navigation intent. No drafts or tokens in URLs.
    router.push({ pathname: needsUsername ? '/auth/username' : '/auth/login',
      params: { action: 'choose_pick', itemId: item.id, categoryId: item.categoryId, ...(pickChannel ? { channel: pickChannel } : {}) } });
  };
  const openLogin = () => openRecovery(false);
  const isSuccess = savedChoice !== null;
  const isLoading = isSessionLoading || (!isSuccess && Boolean(params.itemId) && itemQuery.isPending);
  const hasItem = !isLoading && !itemQuery.isError && Boolean(item) && routeMatchesItem;
  // No itemId: the card's own "사진 등록" shortcut leaves this screen and would drop
  // the typed review. Photos are added in step 1 below instead.
  const itemPhoto = item ? <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={`${item.name} 대표 이미지`}
    itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} /> : null;
  // Photo first, review last: an item without a photo gets a required photo
  // step above the review. Editing the review of the current pick skips it.
  const needsPhotoStep = Boolean(user && item && !savedChoice && pickStatus?.type !== 'selected_this'
    && ['active', 'discontinued'].includes(item.status)
    && !item.imagePath && !item.imageUrl && !item.thumbnailUrl && !item.imageSourceUrl);
  // The receipt keeps its save snapshot, but the OPTIONAL photo invitation uses
  // current, successfully refreshed item data. Unknown/failed reads are not empty photos.
  const photoCandidate = itemQuery.data?.item;
  const canOfferPhoto = Boolean(savedChoice && user?.id === savedChoice.pick.userId && !photoOfferSkipped
    && !isSessionLoading && !sessionError && !itemQuery.isPending && !itemQuery.isError && !itemQuery.isFetching
    && photoCandidate?.id === savedChoice.pick.itemId && ['active', 'discontinued'].includes(photoCandidate.status)
    && !photoCandidate.imagePath && !photoCandidate.imageUrl && !photoCandidate.thumbnailUrl && !photoCandidate.imageSourceUrl);
  const openPhoto = () => {
    if (!canOfferPhoto || !savedChoice || photoOfferClosed.current) return;
    photoOfferClosed.current = true;
    router.replace({ pathname: '/item/[itemId]', params: { itemId: savedChoice.pick.itemId, pickId: savedChoice.pick.id, photo: '1' } });
  };
  // Came from a review's comments (pick-first prompt): go back there to comment.
  const backToComments = () => {
    if (!returnPickId) return;
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/pick/[pickId]', params: { pickId: returnPickId } });
  };
  const skipPhoto = () => { photoOfferClosed.current = true; setPhotoOfferSkipped(true); };

  if (sessionError) {
    return <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.stateArea}>
        <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요." action={{ label: '다시 확인하기', variant: 'secondary', onPress: retrySession }} />
      </View>
    </SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" disabled={saving} onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Icon name="back" /></Pressable>
        {isLoading ? <View style={styles.stateArea}><StateCard loading title="정보를 확인하고 있어요." /></View> : null}
        {!isLoading && !isSuccess && (itemQuery.isError || !item || !routeMatchesItem) ? <View style={styles.stateArea}>
          <StateCard tone="danger" title="정보를 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 불러와주세요. 없어졌거나 사용할 수 없는 링크일 수도 있어요."
            action={params.itemId && routeMatchesItem ? { label: itemQuery.isFetching ? '다시 불러오는 중…' : '정보 다시 불러오기', accessibilityLabel: '정보 다시 불러오기', variant: 'secondary', disabled: itemQuery.isFetching, onPress: retryItem } : undefined} />
          <Button variant="ghost" label="돌아가기" onPress={goBack} style={styles.centered} />
        </View> : null}
        {hasItem && item && !canSubmit && !isSuccess ? <View style={styles.stateArea}>
          <StateCard
            title={isOwnRequest ? '관리자 확인 중이에요.' : '지금은 선택할 수 없어요.'}
            text={isOwnRequest ? '승인돼도 원픽으로 자동 등록되지 않아요. 확인이 끝난 뒤 직접 원픽으로 선택할 수 있고, 수정이 필요할 때만 알려드려요.' : '지금은 여기서 새 원픽을 선택할 수 없어요.'}
            action={isOwnRequest
              ? { label: '내 등록 요청 보기', variant: 'secondary', onPress: () => router.replace('/(tabs)/profile') }
              : { label: pickStatus?.type === 'selected_this' ? '내 원픽 보기/수정' : '상세 보기', variant: 'secondary',
                  onPress: () => router.replace(pickStatus?.type === 'selected_this'
                    ? { pathname: '/pick/[pickId]', params: { pickId: pickStatus.pickId } } : { pathname: '/item/[itemId]', params: { itemId: item.id } }) }} />
        </View> : null}
        {hasItem && item && canChoose && !user ? <View style={styles.panel}>
          {itemPhoto}
          <Text style={styles.panelTitle}>원픽을 고르려면 로그인이 필요해요.</Text>
          <Text style={styles.panelText}>선택한 원픽을 기억해두고 로그인 뒤 이 화면으로 바로 돌아와요.</Text>
          <Button size="lg" fullWidth label="로그인하고 계속" onPress={openLogin} style={styles.panelAction} />
          <Button variant="ghost" label="다음에 고르기" onPress={goBack} />
        </View> : null}
        {hasItem && item && canSubmit && user && !isSuccess ? <>
          <View style={styles.markRow}><BrandMark size="sm" /><Text style={styles.markLabel}>{pickChannel ? `${channelLabel(pickChannel)} · 메뉴마다 단 하나` : '카테고리마다 단 하나'}</Text></View>
          <Text style={styles.title}>{formTitle}</Text>
          <View style={styles.itemCard}>
            {itemPhoto}
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemState}>{pickStatus?.type === 'selected_other' ? '현재 원픽을 변경해요.' : pickStatus?.type === 'selected_this' ? '현재 원픽의 한줄평을 수정해요.' : '이걸 새 원픽으로 선택해요.'}</Text>
            </View>
          </View>
          {pickStatus?.type === 'selected_other' ? <View style={styles.notice}><Text style={styles.noticeText}>{pickChannel ? `저장하면 이 메뉴의 ${channelLabel(pickChannel)} 원픽이 바뀌어요.` : '저장하면 이 카테고리의 원픽이 바뀌어요.'}</Text></View> : null}
          {needsPhotoStep && user && item ? <PickPhotoStep userId={user.id} itemId={item.id} disabled={saving}
            onAttached={(saved) => { setPhotoItem(saved); void itemQuery.refetch().catch(() => {}); }} /> : null}
          <View style={styles.inputHeader}><Text style={styles.inputLabel}>{photoItem || needsPhotoStep ? '2. ' : ''}한 줄 이유 <Text style={styles.required}>필수</Text></Text><Text style={styles.counter}>{review.length}/100</Text></View>
          <TextInput ref={reviewInput} accessibilityLabel="원픽 한줄평" maxLength={100} multiline editable={!saving}
            onChangeText={(value) => { if (submitPhase.current !== 'saving') setReview(value); }}
            placeholder="예: 결국 기본으로 돌아오게 되는 맛" placeholderTextColor={OnePick.textSecondary} style={[styles.reviewInput, hasReviewError && styles.reviewInputError]} value={review} />
          <Text style={styles.helperText}>이유는 원픽과 함께 공개돼요. 1~100자면 충분해요.</Text>
          {hasReviewError ? <Text accessibilityRole="alert" style={styles.reviewError}>{trimmedReview.length === 0 ? '한줄평을 입력해주세요. 한 글자만 써도 저장할 수 있어요.' : '한줄평은 100자까지 입력할 수 있어요.'}</Text> : null}
          {OnePickFeatures.purchaseLinks ? <>
          <View style={styles.inputHeader}><Text style={styles.inputLabel}>산 곳 링크 <Text style={styles.optional}>선택</Text></Text></View>
          <TextInput accessibilityLabel="산 곳 링크" autoCapitalize="none" autoCorrect={false} editable={!saving}
            inputMode="url" maxLength={2048}
            onChangeText={(value) => { if (submitPhase.current !== 'saving') setDraftUrl(value); }}
            placeholder="https://" placeholderTextColor={OnePick.textSecondary}
            style={[styles.linkInput, hasUrlDraft && !isValidUrl && styles.reviewInputError]} value={draftUrl ?? ''} />
          <Text style={styles.helperText}>안 남겨도 괜찮아요. 제휴 링크는 저장할 때 추적 정보를 떼고 보관해요.</Text>
          {hasUrlDraft && !isValidUrl ? <Text accessibilityRole="alert" style={styles.reviewError}>https:// 로 시작하는 주소만 남길 수 있어요.</Text> : null}
          {showTipQuestion ? <View style={styles.tipAsk}>
            <Text style={styles.tipAskText}>여기서 살 때 알아두면 좋은 게 있나요?</Text>
            <View style={styles.tipAskRow}>
              <Button size="sm" variant={tipAnswer === 'yes' ? 'primary' : 'soft'} label="있어요"
                disabled={saving} onPress={() => setTipAnswer('yes')} />
              <Button size="sm" variant={tipAnswer === 'no' ? 'primary' : 'soft'} label="그냥 판매 링크예요."
                disabled={saving} onPress={() => { setTipAnswer('no'); setDraftTip(''); }} />
            </View>
          </View> : null}
          {showTipInput ? <>
            <View style={styles.inputHeader}><Text style={styles.inputLabel}>살 때 팁</Text><Text style={styles.counter}>{(draftTip ?? '').length}/100</Text></View>
            <TextInput accessibilityLabel="살 때 팁" maxLength={100} multiline editable={!saving}
              onChangeText={(value) => { if (submitPhase.current !== 'saving') setDraftTip(value); }}
              placeholder="예: 6개입이 낱개보다 싸요." placeholderTextColor={OnePick.textSecondary}
              style={styles.linkInput} value={draftTip ?? ''} />
            <Text style={styles.helperText}>팁을 남기면 이 원픽이 쇼핑꿀팁으로 표시돼요. 비워두면 링크만 남아요.</Text>
          </> : null}
          </> : null}
          {commentPickError || (returnPickId && pickStatus?.type !== 'not_selected') ? (
            <Text accessibilityRole="alert" style={styles.reviewError}>
              {commentPickError ?? '댓글 작성 때문에 기존 원픽을 변경하지 않아요. 댓글 화면으로 돌아가주세요.'}
            </Text>
          ) : null}
          {saveError ? <View style={styles.errorBox}>
            <Text accessibilityRole="alert" style={styles.errorText}>{getErrorMessage(saveError)}</Text>
            {saveError instanceof AppError && saveError.code === 'PROFILE_NOT_FOUND' ?
              <Button variant="secondary" size="sm" label="사용자명 만들고 계속" onPress={() => openRecovery(true)} style={styles.errorAction} /> : null}
            {saveError instanceof AppError && saveError.code === 'AUTH_REQUIRED' ?
              <Button variant="secondary" size="sm" label="다시 로그인하고 계속" onPress={openLogin} style={styles.errorAction} /> : null}
          </View> : null}
          <Button size="lg" fullWidth label={submitLabel} loading={saving} disabled={needsPhotoStep || Boolean(returnPickId && pickStatus?.type !== 'not_selected')} onPress={() => void handleSubmit()} style={styles.submit} />
          {needsPhotoStep ? <Text style={styles.footnote}>사진을 먼저 등록하면 저장할 수 있어요.</Text> : null}
          <Text style={styles.footnote}>원픽은 언제든 바꿀 수 있어요.</Text>
        </> : null}
        {!isLoading && item && user && savedChoice ? <View style={styles.successCard}>
          <BrandMark size="lg" soft />
          <Text style={[styles.title, styles.successTitle]}>원픽을 정했어요.</Text>
          <Text style={styles.successItem}>{item.name}</Text><Text style={styles.savedReview}>“{savedChoice.pick.oneLineReview}”</Text>
          <View style={styles.successPhoto}>{itemPhoto}</View>
          <Text style={styles.panelText}>내 원픽은 내 프로필에 모이고, 홈에서는 다른 사람의 원픽을 둘러볼 수 있어요.</Text>
          <View style={styles.successActions}>
            {returnPickId && savedChoice.published !== false ? <>
              <Button size="lg" fullWidth label="댓글 남기러 가기" onPress={backToComments} style={styles.submit} />
              <Button variant="ghost" label="내 원픽 보기" onPress={() => router.replace({ pathname: '/item/[itemId]', params: { itemId: savedChoice.pick.itemId, pickId: savedChoice.pick.id } })} style={styles.centered} />
            </> : <>
              {returnPickId && savedChoice.published === false
                ? <Text style={styles.panelText}>사진 확인이 끝나면 댓글을 남길 수 있어요.</Text> : null}
              <Button size="lg" fullWidth label="내 원픽 보기" onPress={() => router.replace({ pathname: '/item/[itemId]', params: { itemId: savedChoice.pick.itemId, pickId: savedChoice.pick.id } })} style={styles.submit} />
              <Button variant="ghost" label="다른 사람의 원픽 계속 보기" onPress={() => router.replace('/')} style={styles.centered} />
            </>}
          </View>
          {canOfferPhoto && photoCandidate ? <View style={styles.photoOffer}>
            <Text style={styles.offerTitle}>내가 고른 {photoCandidate.name}에 사진도 남겨볼까요?</Text>
            <Text style={styles.offerText}>올린 사진은 내 원픽뿐 아니라, 같은 원픽을 고른 사람들의 카드에도 함께 표시돼요. 사진 아래에는 등록자 이름이 남아요.</Text>
            <Text style={styles.offerText}>이름이 잘 보이는 사진이면 충분해요.</Text>
            <Button variant="secondary" label="사진 등록하기" accessibilityLabel="내 원픽 사진 등록하기" onPress={openPhoto} style={styles.offerAction} />
            <Button variant="ghost" size="sm" label="지금은 넘어가기" onPress={skipPhoto} />
          </View> : null}
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  stateArea: { marginTop: 34, gap: 12, alignItems: 'stretch' },
  centered: { alignSelf: 'center' },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  markLabel: { color: OnePick.accentDeep, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 8 },
  notice: { backgroundColor: OnePick.accentSoft, borderRadius: 20, padding: 14, marginTop: 12 },
  noticeText: { color: OnePick.accentDeep, fontSize: 14, lineHeight: 20 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 14, marginTop: 20 },
  itemCopy: { flex: 1, paddingLeft: 16 },
  itemName: { color: OnePick.text, fontSize: 17, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4 },
  itemState: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginTop: 4 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, marginBottom: 8 },
  inputLabel: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  required: { color: OnePick.danger, fontSize: 12, fontWeight: '600' },
  counter: { color: OnePick.muted, fontSize: 12 },
  reviewInput: { minHeight: 124, borderRadius: 12, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, paddingHorizontal: 16, paddingVertical: 14, color: OnePick.text, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  reviewInputError: { borderColor: OnePick.danger },
  linkInput: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, paddingHorizontal: 16, paddingVertical: 12, color: OnePick.text, fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  optional: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  tipAsk: { backgroundColor: OnePick.accentSoft, borderRadius: 12, padding: 14, marginTop: 12 },
  tipAskText: { color: OnePick.accentDeep, fontSize: 14, lineHeight: 20 },
  tipAskRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  submit: { marginTop: 24 },
  footnote: { color: OnePick.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 8 },
  errorAction: { marginTop: 10 },
  reviewError: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 8 },
  helperText: { color: OnePick.muted, fontSize: 12, marginTop: 8 },
  errorBox: { backgroundColor: OnePick.dangerSoft, borderRadius: 12, padding: 14, marginTop: 14 },
  panel: { alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 24, marginTop: 34 },
  panelTitle: { color: OnePick.text, fontSize: 19, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center', marginTop: 16 },
  panelText: { color: OnePick.muted, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  panelAction: { marginTop: 20, marginBottom: 4 },
  errorText: { color: OnePick.danger, fontSize: 13, lineHeight: 18 },
  successCard: { alignItems: 'center', paddingTop: 58 },
  successTitle: { textAlign: 'center', marginTop: 20 },
  successItem: { color: OnePick.text, fontSize: 17, lineHeight: 24, fontWeight: '700', marginTop: 20 },
  savedReview: { color: OnePick.text, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8, paddingHorizontal: 18 },
  successPhoto: { marginTop: 16 },
  successActions: { alignSelf: 'stretch', width: '100%' },
  photoOffer: { alignSelf: 'stretch', alignItems: 'flex-start', borderRadius: 20, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, padding: 18, marginTop: 20 },
  offerAction: { marginTop: 14 },
  offerTitle: { color: OnePick.text, fontSize: 15, lineHeight: 23, fontWeight: '800' },
  offerText: { color: OnePick.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
  pressed: { opacity: 0.7 },
});
