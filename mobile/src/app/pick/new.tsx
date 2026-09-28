import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, StateCard } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useChoosePick, useRequestPendingPick } from '@/hooks/useChoosePick';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useAttachPendingItemLink } from '@/hooks/useLinkCategorySuggestions';
import { useAttachItemPhoto, useChoosePhoto, useRegisterPick } from '@/hooks/useRegisterPick';
import { useMenuOptions, useMenuSuggestions, useSelectStoreItem, useSetMenuHint, useStoreSearch, useSuggestMapLink } from '@/hooks/useStoreFirst';
import { isDeliveryAppUrl, PLACE_COVERAGE_NOTICE, type PickChannel } from '@/lib/items/pickChannel';
import { isPhotoFailure, showPhotoFailure } from '@/lib/photos/photoFailure';
import { isNaverMapUrl, type MenuOption, type StoreCandidate } from '@/services/storeFirstService';
import type { PickPhotoDraft } from '@/types/domain/photo';

// 원픽 등록 6단계: 채널 → 상호 → 필요한 링크 → 메뉴 → 사진 → 한줄평. 저장 성공은 모달로 확인한다.
// Everything the user enters lives in this one screen's state, so moving back
// and forth between steps never loses a typed review, link or chosen photo.

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type NewStore = { kind: 'new'; name: string; channel: PickChannel };
type Store = StoreCandidate | NewStore;
type Done =
  | { type: 'pick'; pickId: string; itemId: string }
  | { type: 'pending'; itemName: string; linkSaved: boolean };

const STEP_LABELS = ['채널', '상호', '링크', '메뉴', '사진', '한줄평'];

function httpsUrl(value: string) {
  const url = value.trim();
  if (!url || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'AUTH_REQUIRED': return '로그인이 만료됐어요. 다시 로그인한 뒤 이어가주세요.';
      case 'PROFILE_NOT_FOUND': return '원픽을 남기려면 사용자명을 먼저 정해주세요.';
      case 'CATEGORY_NOT_PICKABLE': return '이 메뉴는 지금 고를 수 없어요. 다른 메뉴를 골라주세요.';
      case 'ITEM_NOT_ELIGIBLE':
      case 'ITEM_NOT_FOUND': return '지금은 이 매장을 원픽으로 고를 수 없어요.';
      case 'ITEM_ALREADY_PENDING': return '지금은 이 매장을 새 원픽으로 저장할 수 없어요. 잠시 후 다시 시도해주세요.';
      case 'PROVIDER_NOT_FOUND': return '이 판매처는 지금 고를 수 없어요.';
      case 'REVIEW_INVALID': return '한줄평을 1~100자로 입력해주세요.';
      case 'ITEM_NAME_INVALID': return '매장 이름을 1~100자로 입력해주세요.';
      case 'LINK_INVALID': return '네이버 지도 링크(naver.me, map.naver.com)만 남길 수 있어요.';
      case 'RATE_LIMITED': return '요청이 많아요. 잠시 후 다시 시도해주세요.';
      case 'PHOTO_INVALID': return '사진을 읽지 못했어요. JPG·PNG 사진을 다시 선택해주세요.';
      case 'PHOTO_TOO_LARGE': return '사진이 너무 커요. 다른 사진을 선택해주세요.';
      case 'PHOTO_UPLOAD_FAILED': return '사진을 저장하지 못했어요. 선택한 사진은 그대로 있어요.';
      default: break;
    }
  }
  return '저장하지 못했어요. 잠시 후 다시 시도해주세요.';
}

export default function NewPickScreen() {
  const router = useRouter();
  const auth = useAuthSession();
  const user = auth.user;
  const [step, setStep] = useState<Step>(1);
  const [channel, setChannel] = useState<PickChannel>('offline');
  const [query, setQuery] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [newName, setNewName] = useState('');
  const [sellerUrl, setSellerUrl] = useState('');
  const [store, setStore] = useState<Store | null>(null);
  const [menuQuery, setMenuQuery] = useState('');
  // categoryId null: the user entered a menu that does not exist yet.
  const [menu, setMenu] = useState<{ categoryId: string | null; name: string } | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  // Known from the selected item row itself, before the item detail loads.
  const [itemHadPhoto, setItemHadPhoto] = useState(false);
  const [itemPending, setItemPending] = useState(false);
  const [photoStepVisited, setPhotoStepVisited] = useState(false);
  const [mapLink, setMapLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSaved, setLinkSaved] = useState(false);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [review, setReview] = useState('');
  const [showReviewError, setShowReviewError] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const busy = useRef(false);

  const isNew = store?.kind === 'new';
  const storeChannel: PickChannel = store ? (store.kind === 'seller' ? 'online' : store.kind === 'place' ? 'offline' : store.channel) : channel;
  const search = useStoreSearch(channel, query, Boolean(user) && step === 2 && !requesting);
  const menus = useMenuOptions(Boolean(user) && step === 4);
  const suggestionStore = useMemo(() => store ? {
    name: store.name,
    branchName: store.kind === 'place' ? store.branchName : null,
    providerCategory: store.kind === 'place' ? store.providerCategory : null,
    region: store.kind === 'place' ? store.region : null,
    channel: storeChannel,
  } : null, [store, storeChannel]);
  const storeKey = store ? (store.kind === 'place' ? `place:${store.catalogId}` : store.kind === 'seller' ? `seller:${store.providerId}` : `new:${storeChannel}:${store.name}`) : '';
  const suggestions = useMenuSuggestions(suggestionStore, storeKey, Boolean(user) && step === 4);
  const selectItem = useSelectStoreItem();
  const itemDetail = useItemDetail(itemId ?? undefined, user?.id);
  const suggestLink = useSuggestMapLink();
  const choosePhoto = useChoosePhoto();
  const attachItemPhoto = useAttachItemPhoto();
  const choosePick = useChoosePick();
  const requestPick = useRequestPendingPick();
  const registration = useRegisterPick();
  const attachSellerLink = useAttachPendingItemLink();
  const menuHint = useSetMenuHint();

  const item = itemDetail.data?.item;
  const itemHasPhoto = Boolean(item && (item.imagePath || item.imageUrl || item.thumbnailUrl || item.imageSourceUrl));
  // Existing verified places may reuse their saved map link. A newly entered online seller
  // collects its purchase/source link here; existing-provider product-link reuse is wired
  // when the atomic registration contract is available.
  const needsLink = storeChannel === 'offline'
    ? !(store?.kind === 'place' && store.mapUrl)
    : store?.kind === 'new';
  // A pending request cannot take a photo yet (attach_item_photo needs a reviewed item).
  const isRequest = isNew || itemPending;
  const needsPhoto = isNew || (!itemPending && !(itemHadPhoto || itemHasPhoto));
  const trimmedReview = review.trim();
  const reviewValid = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const saving = choosePick.isPending || requestPick.isPending || registration.isPending || attachItemPhoto.isPending || attachSellerLink.isPending || menuHint.isPending;
  const isReplacing = !itemPending && itemDetail.data?.myPickStatus?.type === 'selected_other';
  const photoReady = !needsPhoto || Boolean(photo) || itemHadPhoto || itemHasPhoto;

  const previousFrom = (from: Step): Step => {
    if (from === 2) return 1;
    if (from === 3) return 2;
    if (from === 4) return needsLink ? 3 : 2;
    if (from === 5) return 4;
    if (from === 6) return photoStepVisited ? 5 : 4;
    return (from - 1) as Step;
  };
  const goBack = () => {
    if (saving || busy.current) return;
    if (step === 1) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    setStep(previousFrom(step));
  };

  const chooseChannel = (next: PickChannel) => {
    if (channel !== next) {
      setQuery(''); setRequesting(false); setNewName(''); setSellerUrl(''); setStore(null);
      setMenuQuery(''); setMenu(null); setItemId(null); setItemHadPhoto(false); setItemPending(false); setPhotoStepVisited(false);
      setMapLink(''); setLinkError(null); setLinkSaved(false); setPhoto(null); setReview(''); setShowReviewError(false);
    }
    setChannel(next);
  };
  const confirmChannel = () => {
    if (channel === 'recipe') {
      router.push('/pick/recipe');
      return;
    }
    setStep(2);
  };

  const pickStore = (candidate: Store) => {
    if (store && storeKey !== (candidate.kind === 'place' ? `place:${candidate.catalogId}` : candidate.kind === 'seller' ? `seller:${candidate.providerId}` : `new:${candidate.channel}:${candidate.name}`)) {
      setMenu(null); setItemId(null); setItemHadPhoto(false); setItemPending(false); setPhotoStepVisited(false); setLinkSaved(false); setMapLink(''); setSellerUrl(''); setLinkError(null); setPhoto(null); setReview(''); setShowReviewError(false);
    }
    setStore(candidate);
    const candidateChannel: PickChannel = candidate.kind === 'seller' ? 'online' : candidate.kind === 'place' ? 'offline' : candidate.channel;
    const candidateNeedsLink = candidateChannel === 'offline'
      ? !(candidate.kind === 'place' && candidate.mapUrl)
      : candidate.kind === 'new';
    setStep(candidateNeedsLink ? 3 : 4);
  };
  const newStoreName = newName.trim().replace(/\s+/g, ' ');
  const validSellerUrl = httpsUrl(sellerUrl);
  const canRequest = newStoreName.length >= 1 && newStoreName.length <= 100;

  const confirmMenu = async () => {
    if (!store || !menu || busy.current) return;
    if (store.kind === 'new' || !menu.categoryId) { setPhotoStepVisited(true); setStep(5); return; }
    busy.current = true;
    try {
      const selected = await selectItem.mutateAsync({ categoryId: menu.categoryId, store });
      setItemId(selected.itemId);
      setItemHadPhoto(selected.hasPhoto);
      setItemPending(selected.pending);
      setPhotoStepVisited(!selected.hasPhoto && !selected.pending);
      if (storeChannel === 'offline' && mapLink.trim() && isNaverMapUrl(mapLink)) {
        try {
          await suggestLink.mutateAsync({ itemId: selected.itemId, url: mapLink.trim() });
          setLinkSaved(true);
        } catch (error) {
          setLinkError(errorMessage(error));
          setStep(3);
          return;
        }
      }
      setStep(selected.hasPhoto || selected.pending ? 6 : 5);
    } catch { /* The mutation error is shown under the menu list. */ }
    finally { busy.current = false; }
  };

  const confirmLink = () => {
    setLinkError(null);
    if (storeChannel === 'offline') {
      if (!mapLink.trim() || !isNaverMapUrl(mapLink)) {
        setLinkError('네이버 지도 링크(naver.me, map.naver.com)를 입력해주세요.');
        return;
      }
    } else {
      const normalized = httpsUrl(sellerUrl);
      if (!normalized || isDeliveryAppUrl(sellerUrl)) {
        setLinkError(isDeliveryAppUrl(sellerUrl) ? '배달앱 주문은 매장으로 골라주세요.' : 'https://로 시작하는 구매 링크를 입력해주세요.');
        return;
      }
    }
    if (menu) setPhotoStepVisited(true);
    setStep(menu ? 5 : 4);
  };

  const pickNewPhoto = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const selected = await choosePhoto.mutateAsync();
      if (selected) setPhoto(selected);
    } catch (error) { showPhotoFailure(error, 'store_pick_photo_choose'); }
    finally { busy.current = false; }
  };

  const save = async () => {
    if (!user || !store || !menu || busy.current || saving) return;
    if (!reviewValid) { setShowReviewError(true); return; }
    busy.current = true;
    setSaveError(null);
    try {
      if (store.kind !== 'new') {
        if (!itemId || !menu.categoryId) return;
        if (itemPending) {
          await requestPick.mutateAsync({ itemId, oneLineReview: trimmedReview });
          setDone({ type: 'pending', itemName: store.name, linkSaved });
          return;
        }
        if (needsPhoto) {
          if (!photo) { setSaveError(new AppError('PHOTO_INVALID')); return; }
          await attachItemPhoto.mutateAsync({ userId: user.id, itemId, photo });
          setItemHadPhoto(true);
          void itemDetail.refetch();
        }
        const pick = await choosePick.mutateAsync({
          categoryId: menu.categoryId, itemId, oneLineReview: trimmedReview, channel: storeChannel,
        });
        setDone({ type: 'pick', pickId: pick.id, itemId: pick.itemId });
      } else {
        const result = await registration.mutateAsync({
          userId: user.id, categoryId: menu.categoryId ?? undefined, itemName: store.name, variant: '',
          oneLineReview: trimmedReview, photo, channel: store.channel,
        });
        if (result.type === 'pick') {
          setDone({ type: 'pick', pickId: result.pick.id, itemId: result.pick.itemId });
        } else {
          if (!menu.categoryId) await menuHint.mutateAsync({ userId: user.id, itemId: result.item.id, label: menu.name });
          if (validSellerUrl) await attachSellerLink.mutateAsync({ itemId: result.item.id, url: validSellerUrl });
          let saved = false;
          if (mapLink.trim() && isNaverMapUrl(mapLink)) {
            saved = await suggestLink.mutateAsync({ itemId: result.item.id, url: mapLink.trim() }).then(() => true, () => false);
          }
          setDone({ type: 'pending', itemName: result.item.name, linkSaved: saved });
        }
      }
    } catch (error) {
      if (photo && isPhotoFailure(error)) showPhotoFailure(error, 'store_pick_photo_upload');
      setSaveError(error);
    } finally { busy.current = false; }
  };

  const menuMatches = useMemo(() => {
    const options = (menus.data ?? []).filter((option) => storeChannel === 'online' || option.placeEnabled);
    const q = menuQuery.trim().replace(/\s+/g, '').toLowerCase();
    // "클래식 밀크티" should still find a "밀크티" menu, so match both ways.
    return q ? options.filter((option) => {
      const name = option.name.replace(/\s+/g, '').toLowerCase();
      return name.includes(q) || q.includes(name);
    }).slice(0, 30) : options.slice(0, 30);
  }, [menus.data, menuQuery, storeChannel]);
  const aiAllowed = new Set((menus.data ?? []).filter((option) => storeChannel === 'online' || option.placeEnabled).map((option) => option.categoryId));
  const aiSuggestions = (suggestions.data?.suggestions ?? []).filter((entry) => aiAllowed.size === 0 || aiAllowed.has(entry.categoryId));
  const requestedMenu = menuQuery.trim().replace(/\s+/g, ' ');
  // No menu fits: keep the typed menu in the draft. The current backend still
  // saves this through the legacy request path until the atomic registration RPC lands.
  const requestMenu = () => {
    if (!store || !requestedMenu || requestedMenu.length > 60) return;
    if (store.kind !== 'new') {
      setStore({
        kind: 'new',
        name: store.kind === 'place' && store.branchName ? `${store.name} ${store.branchName}` : store.name,
        channel: storeChannel,
      });
      if (store.kind === 'place' && store.mapUrl) setMapLink(store.mapUrl);
    }
    setItemId(null); setItemHadPhoto(false); setItemPending(false); setPhotoStepVisited(true);
    setMenu({ categoryId: null, name: requestedMenu });
    const linkReady = storeChannel === 'offline'
      ? Boolean((mapLink.trim() && isNaverMapUrl(mapLink)) || (store.kind === 'place' && store.mapUrl))
      : Boolean(validSellerUrl);
    if (storeChannel === 'offline' && !mapLink.trim() && store.kind === 'place' && store.mapUrl) setMapLink(store.mapUrl);
    setStep(linkReady ? 5 : 3);
  };
  const chooseMenu = (option: Pick<MenuOption, 'categoryId' | 'name'>) => {
    if (menu?.categoryId !== option.categoryId) { setItemId(null); setItemHadPhoto(false); setItemPending(false); setPhotoStepVisited(false); setLinkSaved(false); }
    setMenu({ categoryId: option.categoryId, name: option.name });
  };

  const channelLabel = channel === 'online' ? '온라인 매장' : channel === 'recipe' ? '레시피' : '오프라인 매장';
  const header = <View style={styles.header}>
    <View style={styles.headerRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="이전 단계" onPress={goBack} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
      <Text style={styles.headerTitle}>{step >= 3 ? '새 원픽 등록' : '원픽 등록'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록 취소" onPress={() => router.replace('/')} style={styles.cancel}><Text style={styles.cancelText}>취소</Text></Pressable>
    </View>
    <Text style={styles.stepLabel} accessibilityLabel={`${step} / 6 단계 · ${STEP_LABELS[step - 1]}`}>
      {step} / 6{step === 4 && store ? ` · ${store.name} · ${channelLabel}` : step > 1 ? ` · ${channelLabel}` : ''}
    </Text>
  </View>;

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.content}><StateCard loading title="로그인 상태를 확인하고 있어요" /></View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content}>
      {header}
      <Text style={styles.title}>원픽 등록</Text>
      <StateCard title="로그인하고 원픽을 등록해보세요" text="좋아하는 매장을 찾고, 메뉴와 한줄평을 남기면 내 원픽이 돼요."
        action={{ label: '로그인', variant: 'primary', onPress: () => router.push({ pathname: '/auth/login', params: { action: 'store_pick' } }) }} />
    </ScrollView></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {header}

        {step === 1 ? <>
          <Text style={styles.title}>채널을 선택해 주세요</Text>
          <View style={styles.channelList}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: channel === 'online' }} accessibilityLabel="온라인 채널 선택"
              onPress={() => chooseChannel('online')} style={({ pressed }) => [styles.channelCard, channel === 'online' && styles.channelCardSelected, pressed && styles.channelPressed]}>
              <Text style={styles.channelTitle}>{channel === 'online' ? '●' : '○'}  온라인 매장</Text>
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: channel === 'offline' }} accessibilityLabel="매장 채널 선택"
              onPress={() => chooseChannel('offline')} style={({ pressed }) => [styles.channelCard, channel === 'offline' && styles.channelCardSelected, pressed && styles.channelPressed]}>
              <Text style={styles.channelTitle}>{channel === 'offline' ? '●' : '○'}  오프라인 매장</Text>
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: channel === 'recipe' }} accessibilityLabel="레시피 채널 선택"
              onPress={() => chooseChannel('recipe')} style={({ pressed }) => [styles.channelCard, channel === 'recipe' && styles.channelCardSelected, pressed && styles.channelPressed]}>
              <Text style={styles.channelTitle}>{channel === 'recipe' ? '●' : '○'}  레시피</Text>
            </Pressable>
          </View>
          <Text style={styles.helper}>한 가지를 선택해 주세요.</Text>
          <Button fullWidth size="lg" label="다음" onPress={confirmChannel} style={styles.primary} />
        </> : null}

        {step === 2 ? <>
          <Text style={styles.title}>{channel === 'online' ? '판매처명을 검색해 주세요' : '상호명을 검색해 주세요'}</Text>
          <Text style={styles.subtitle}>{channel === 'online' ? '택배·온라인몰로 주문한 판매처 이름을 검색해주세요.' : '가게 이름을 검색하고 지점을 골라주세요.'}</Text>
          {!requesting ? <>
            <TextInput accessibilityLabel={channel === 'online' ? '판매처 이름 검색' : '매장명 검색'} autoFocus autoCapitalize="none" maxLength={100}
              onChangeText={setQuery} value={query} returnKeyType="search" style={styles.input} placeholderTextColor={OnePick.hint}
              placeholder={channel === 'online' ? '판매처 이름 검색: ○○몰, 스마트스토어…' : '매장명 검색: 을밀대, 우래옥…'} />
            {channel === 'offline' ? <Text style={styles.helper}>{PLACE_COVERAGE_NOTICE} 배달로 주문한 곳도 매장으로 골라주세요.</Text> : null}
            {search.valid && (search.isWaiting || search.isFetching) ? <View style={styles.loading}><ActivityIndicator color={OnePick.accent} /></View> : null}
            {search.isError ? <StateCard compact tone="danger" title="검색하지 못했어요" action={{ label: '다시 검색', onPress: () => { void search.refetch(); } }} /> : null}
            {(search.data ?? []).map((candidate) => <Pressable key={candidate.kind === 'place' ? candidate.catalogId : candidate.providerId}
              accessibilityRole="button" accessibilityLabel={`${candidate.name} 선택`} onPress={() => pickStore(candidate)} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{candidate.name}{candidate.kind === 'place' && candidate.branchName ? ` ${candidate.branchName}` : ''}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>{candidate.kind === 'place' ? [candidate.region, candidate.providerCategory].filter(Boolean).join(' · ') : candidate.host}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>)}
            {search.valid && !search.isWaiting && !search.isFetching && !search.isError && (search.data ?? []).length === 0
              ? <Text style={styles.helper}>검색한 이름의 {channel === 'online' ? '판매처' : '매장'}를 찾지 못했어요.</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => { setRequesting(true); setNewName(query); }} style={styles.requestLink}>
              <Text style={styles.helper}>찾는 {channel === 'online' ? '판매처' : '매장'}가 없나요? <Text style={styles.link}>새 {channel === 'online' ? '판매처' : '매장'} 등록</Text></Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/pick/find')} style={styles.requestLink}>
              <Text style={styles.helper}>레시피 원픽은 <Text style={styles.link}>메뉴부터 찾기</Text></Text>
            </Pressable>
          </> : <View style={styles.card}>
            <Text style={styles.cardTitle}>새 {channel === 'online' ? '판매처' : '매장'} 정보</Text>
            <Text style={styles.helper}>이름을 입력하면 다음 단계에서 필요한 링크와 메뉴를 이어서 확인합니다.</Text>
            <TextInput accessibilityLabel={channel === 'online' ? '새 판매처 이름' : '새 매장 이름'} maxLength={100} value={newName} onChangeText={setNewName} style={styles.input}
              placeholder={channel === 'online' ? '판매처 이름' : '매장 이름 (지점명 포함)'} placeholderTextColor={OnePick.hint} />
            <Button fullWidth label={channel === 'online' ? '이 판매처로 계속' : '이 상호로 계속'} disabled={!canRequest} onPress={() => pickStore({ kind: 'new', name: newStoreName, channel })} style={styles.primary} />
            <Button variant="ghost" size="sm" label="다시 검색하기" onPress={() => setRequesting(false)} />
          </View>}
        </> : null}

        {step === 4 && store ? <>
          <Text style={styles.title}>메뉴명을 입력해 주세요</Text>
          <Text style={styles.subtitle}>{store.name}에서 고른 메뉴를 입력하거나 추천 목록에서 골라주세요.</Text>
          <Text style={styles.section}>AI 추천</Text>
          {suggestions.isPending ? <View style={styles.loadingRow}><ActivityIndicator color={OnePick.accent} /><Text style={styles.helper}>메뉴를 추천하고 있어요</Text></View>
            : aiSuggestions.length ? <View style={styles.chips}>
              {aiSuggestions.map((entry) => <Chip key={entry.categoryId} label={entry.label.split(' › ').pop() ?? entry.label}
                accessibilityLabel={`AI 추천 ${entry.label}`} selected={menu?.categoryId === entry.categoryId}
                onPress={() => chooseMenu({ categoryId: entry.categoryId, name: entry.label.split(' › ').pop() ?? entry.label })} />)}
            </View>
            : <Text style={styles.helper}>{suggestions.isError ? 'AI 추천을 불러오지 못했어요. 아래에서 직접 골라주세요.' : '추천할 메뉴를 찾지 못했어요. 아래에서 직접 골라주세요.'}</Text>}
          {aiSuggestions.find((entry) => entry.categoryId === menu?.categoryId)
            ? <Text style={styles.helper}>{aiSuggestions.find((entry) => entry.categoryId === menu?.categoryId)?.reason}</Text> : null}
          <Text style={styles.section}>직접 찾기</Text>
          <TextInput accessibilityLabel="메뉴 검색" maxLength={60} value={menuQuery} onChangeText={setMenuQuery} style={styles.input}
            placeholder="메뉴 검색: 평양냉면, 도가니탕…" placeholderTextColor={OnePick.hint} />
          {menus.isError ? <StateCard compact tone="danger" title="메뉴를 불러오지 못했어요" action={{ label: '다시 불러오기', onPress: () => { void menus.refetch(); } }} /> : null}
          <View style={styles.chips}>
            {menuMatches.map((option) => <Chip key={option.categoryId} label={option.name} selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
          </View>
          {menus.data && requestedMenu && menuMatches.length === 0 ? <View style={styles.card}>
            <Text style={styles.cardTitle}>'{requestedMenu}' 메뉴가 아직 없어요</Text>
            <Text style={styles.helper}>아직 없는 메뉴예요. 이 이름으로 계속하면 사진과 한줄평을 이어서 입력할 수 있어요.</Text>
            {requestedMenu.length > 60 ? <Text accessibilityRole="alert" style={styles.error}>메뉴 이름은 60자까지 적을 수 있어요.</Text> : null}
            <Button fullWidth label={`'${requestedMenu}' 메뉴로 계속`} disabled={requestedMenu.length > 60} onPress={requestMenu} style={styles.primary} />
          </View> : null}
          {selectItem.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(selectItem.error)}</Text> : null}
          <Button fullWidth size="lg" label={menu ? `${menu.name}(으)로 다음` : '메뉴를 골라주세요'} disabled={!menu}
            loading={selectItem.isPending} onPress={() => void confirmMenu()} style={styles.primary} />
        </> : null}

        {step === 3 && store ? <>
          <Text style={styles.title}>{storeChannel === 'offline' ? '매장 링크를 입력해 주세요' : '구매 링크를 입력해 주세요'}</Text>
          <Text style={styles.subtitle}>{storeChannel === 'offline'
            ? `${store.name}을(를) 정확히 찾을 수 있는 네이버 지도 링크가 필요해요.`
            : '실제로 주문할 수 있는 개별 구매 페이지 링크를 입력해주세요.'}</Text>
          {storeChannel === 'offline' ? <TextInput accessibilityLabel="네이버 지도 링크" autoCapitalize="none" keyboardType="url" maxLength={2048} value={mapLink}
            onChangeText={(value) => { setMapLink(value); setLinkError(null); }} style={styles.input} placeholder="https://naver.me/…" placeholderTextColor={OnePick.hint} />
            : <TextInput accessibilityLabel="구매 링크" autoCapitalize="none" keyboardType="url" maxLength={2048} value={sellerUrl}
              onChangeText={(value) => { setSellerUrl(value); setLinkError(null); }} style={styles.input} placeholder="https://…" placeholderTextColor={OnePick.hint} />}
          {linkError ? <Text accessibilityRole="alert" style={styles.error}>{linkError}</Text>
            : <Text style={styles.helper}>{storeChannel === 'offline' ? '네이버 지도에서 가게를 열고 공유 → 링크 복사를 누르면 돼요.' : '배달앱 링크는 매장 채널에서 등록해주세요.'}</Text>}
          <Button fullWidth size="lg" label="다음" onPress={confirmLink} style={styles.primary} />
        </> : null}

        {step === 5 && store ? <>
          <Text style={styles.title}>{store.name}{menu ? ` ${menu.name}` : ''}</Text>
          <Text style={styles.section}>사진 <Text style={styles.required}>필수</Text></Text>
          <Text style={styles.subtitle}>대표 사진을 한 장 선택해주세요. 저장 전까지 수정하거나 삭제할 수 있어요.</Text>
          {needsPhoto ? <View style={styles.card}>
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" accessibilityLabel="선택한 대표 이미지 미리보기" /> : null}
            {photo ? <View style={styles.photoDraftActions}>
              <Button variant="ghost" size="sm" label="사진 삭제" onPress={() => setPhoto(null)} />
              <Button variant="ghost" size="sm" label="사진 수정" loading={choosePhoto.isPending} onPress={() => void pickNewPhoto()} />
            </View>
              : <Button fullWidth variant="soft" label="사진 선택" loading={choosePhoto.isPending} onPress={() => void pickNewPhoto()} />}
          </View> : itemHasPhoto || itemHadPhoto ? <StateCard compact title="사진이 등록됐어요" /> : null}
          <Button fullWidth size="lg" label={photoReady ? '다음' : '사진을 등록해주세요'} disabled={!photoReady} onPress={() => setStep(6)} style={styles.primary} />
        </> : null}

        {step === 6 && store && menu && done?.type !== 'pending' ? <>
          <Text style={styles.title}>한줄평을 남겨주세요</Text>
          <Text style={styles.subtitle}>{store.name} · {menu.name}</Text>
          {isReplacing
            ? <View style={styles.notice}><Text style={styles.noticeText}>저장하면 이 메뉴의 현재 {storeChannel === 'online' ? '온라인' : '매장'} 원픽이 이 선택으로 바뀝니다.</Text></View> : null}
          <View style={styles.reviewHeader}><Text style={styles.section}>한줄평 · <Text style={styles.required}>필수</Text></Text><Text style={styles.counter}>{review.length}/100자</Text></View>
          <TextInput accessibilityLabel="원픽 한줄평" multiline maxLength={100} editable={!saving && done?.type !== 'pick'} value={review}
            onChangeText={(value) => { setReview(value); setShowReviewError(false); }} style={[styles.input, styles.reviewInput]}
            placeholder="예: 육수가 깔끔해서 계속 생각나요" placeholderTextColor={OnePick.hint} />
          {showReviewError && !reviewValid ? <Text accessibilityRole="alert" style={styles.error}>한줄평을 1~100자로 입력해주세요.</Text> : null}
          {isRequest ? <Text style={styles.helper}>새 원픽 저장은 현재 연결 준비 중이에요.</Text> : null}
          {saveError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(saveError)}</Text> : null}
          {done?.type !== 'pick' ? <Button fullWidth size="lg" label={isReplacing ? '원픽 변경' : isRequest ? '원픽 저장' : '원픽 등록하기'} loading={saving}
            onPress={() => { if (!reviewValid) { setShowReviewError(true); return; } if (isReplacing) setShowReplaceConfirm(true); else void save(); }} style={styles.primary} /> : null}
        </> : null}

        {step === 6 && done?.type === 'pending' && store && menu ? <View style={styles.doneCard}>
          <Text style={styles.title}>새 원픽 저장을 확인하고 있어요</Text>
          <Text style={styles.subtitle}>{store.name} · {menu.name}</Text>
          <Text style={styles.savedReview}>“{trimmedReview}”</Text>
          <Text style={styles.helper}>저장 완료가 확인되기 전에는 원픽으로 표시하지 않아요.</Text>
          <Button fullWidth size="lg" label="프로필로 돌아가기" onPress={() => router.replace('/(tabs)/profile')} style={styles.primary} />
        </View> : null}
      </ScrollView>
      <Modal visible={done?.type === 'pick'} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} accessibilityViewIsModal>
            <Text style={[styles.modalTitle, styles.modalCentered]}>저장 완료</Text>
            <Text style={[styles.modalText, styles.modalCentered]}>내 원픽으로 저장했어요.</Text>
            <Button fullWidth label="확인" onPress={() => {
              if (done?.type === 'pick') router.replace({ pathname: '/item/[itemId]', params: { itemId: done.itemId, pickId: done.pickId } });
            }} style={styles.primary} />
          </View>
        </View>
      </Modal>
      <Modal visible={showReplaceConfirm} transparent animationType="fade" onRequestClose={() => setShowReplaceConfirm(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} accessibilityViewIsModal>
            <Text style={styles.modalTitle}>이 원픽으로 변경할까요?</Text>
            <Text style={styles.modalText}>현재 선택은 그대로 유지되며, 변경이 성공한 뒤에만 새 원픽으로 바뀝니다.</Text>
            <Button fullWidth label="원픽 변경 확인" loading={saving} onPress={() => { setShowReplaceConfirm(false); void save(); }} style={styles.primary} />
            <Button fullWidth variant="ghost" label="원픽 변경 취소" disabled={saving} onPress={() => setShowReplaceConfirm(false)} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  header: { marginTop: 4 },
  headerRow: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8, paddingLeft: 8 },
  backText: { color: OnePick.text, fontSize: 34, lineHeight: 38, fontWeight: '300' },
  headerTitle: { color: OnePick.text, fontSize: 16, lineHeight: 24, fontWeight: '800' },
  cancel: { minWidth: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  cancelText: { color: OnePick.text, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  stepLabel: { color: OnePick.text, fontSize: 13, marginTop: 10 },
  title: { color: OnePick.text, fontSize: 22, lineHeight: 30, fontWeight: '800', letterSpacing: -0.4, marginTop: 14 },
  subtitle: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  channelList: { gap: 12, marginTop: 20 },
  channelCard: { minHeight: 64, borderWidth: 1, borderColor: 'transparent', backgroundColor: OnePick.surface, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center' },
  channelCardSelected: { borderColor: OnePick.text, borderWidth: 1.5 },
  channelPressed: { opacity: 0.7 },
  channelTitle: { color: OnePick.text, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  input: { minHeight: 50, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, paddingHorizontal: 16, color: OnePick.text, fontSize: 15, marginTop: 14 },
  reviewInput: { minHeight: 110, paddingTop: 14, paddingBottom: 14, textAlignVertical: 'top', marginTop: 0 },
  helper: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 8 },
  link: { color: OnePick.accent, fontWeight: '700' },
  loading: { paddingVertical: 16, alignItems: 'center' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10 },
  rowText: { flex: 1 },
  rowTitle: { color: OnePick.text, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: OnePick.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: OnePick.muted, fontSize: 22 },
  requestLink: { marginTop: 18, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 16, marginTop: 16 },
  cardTitle: { color: OnePick.text, fontSize: 16, fontWeight: '700' },
  section: { color: OnePick.text, fontSize: 15, fontWeight: '700', marginTop: 22 },
  required: { color: OnePick.danger, fontSize: 12, fontWeight: '600' },
  counter: { color: OnePick.muted, fontSize: 12 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  notice: { backgroundColor: OnePick.accentSoft, borderRadius: 14, padding: 12, marginTop: 14 },
  noticeText: { color: OnePick.accentDeep, fontSize: 13, lineHeight: 19 },
  preview: { width: '100%', height: 180, borderRadius: 12, marginBottom: 12, backgroundColor: OnePick.background },
  photoDraftActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  primary: { marginTop: 22 },
  doneCard: { alignItems: 'center', paddingTop: 30 },
  doneMark: { color: OnePick.accent, fontSize: 36, fontWeight: '800' },
  savedReview: { color: OnePick.text, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, borderRadius: 20, backgroundColor: OnePick.surface, padding: 20 },
  modalTitle: { color: OnePick.text, fontSize: 20, lineHeight: 28, fontWeight: '800' },
  modalText: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  modalCentered: { textAlign: 'center' },
});
