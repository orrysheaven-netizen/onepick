import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhotoStep } from '@/components/pick-photo-step';
import { StateCard } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useChoosePick, useRequestPendingPick } from '@/hooks/useChoosePick';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useAttachPendingItemLink } from '@/hooks/useLinkCategorySuggestions';
import { useChoosePhoto, useRegisterPick } from '@/hooks/useRegisterPick';
import { useMenuOptions, useMenuSuggestions, useSelectStoreItem, useSetMenuHint, useStoreSearch, useSuggestMapLink } from '@/hooks/useStoreFirst';
import { isDeliveryAppUrl, PLACE_COVERAGE_NOTICE, type PickChannel } from '@/lib/items/pickChannel';
import { isPhotoFailure, showPhotoFailure } from '@/lib/photos/photoFailure';
import { isNaverMapUrl, type MenuOption, type StoreCandidate } from '@/services/storeFirstService';
import type { PickPhotoDraft } from '@/types/domain/photo';

// 원픽 등록 6단계: 매장 → 메뉴 → 네이버 링크 → 사진 → 한줄평 → 완료.
// Everything the user enters lives in this one screen's state, so moving back
// and forth between steps never loses a typed review or a chosen photo.

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type NewStore = { kind: 'new'; name: string; channel: PickChannel; sellerUrl: string | null };
type Store = StoreCandidate | NewStore;
type Done =
  | { type: 'pick'; pickId: string; itemId: string }
  | { type: 'pending'; itemName: string; linkSaved: boolean };


const V6 = {
  background: '#FFFFFF',
  subtle: '#F6F6F8',
  muted: '#EEF0F4',
  text: '#141416',
  secondary: '#6B6E78',
  tertiary: '#8A909C',
  border: '#E8E8ED',
  borderStrong: '#D5D7DE',
  accent: '#B84F00',
  disabled: '#ADB0BA',
  onAction: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.35)',
} as const;

type FlowButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
};

function FlowButton({ label, onPress, variant = 'primary', disabled, loading, accessibilityLabel }: FlowButtonProps) {
  const inactive = Boolean(disabled || loading);
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
    disabled={inactive}
    onPress={onPress}
    style={({ pressed }) => [
      styles.flowButton,
      variant === 'secondary' && styles.flowButtonSecondary,
      variant === 'text' && styles.flowButtonText,
      inactive && variant !== 'text' && styles.flowButtonDisabled,
      pressed && !inactive && styles.flowPressed,
    ]}>
    {loading ? <ActivityIndicator color={variant === 'primary' ? V6.onAction : V6.text} />
      : <Text style={[styles.flowButtonLabel, variant !== 'primary' && styles.flowButtonLabelDark]}>{label}</Text>}
  </Pressable>;
}

type FlowChipProps = { label: string; selected?: boolean; onPress?: () => void; accessibilityLabel?: string };

function FlowChip({ label, selected = false, onPress, accessibilityLabel }: FlowChipProps) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed }) => [styles.flowChip, selected && styles.flowChipSelected, pressed && styles.flowPressed]}>
    <Text style={[styles.flowChipLabel, selected && styles.flowChipLabelSelected]}>{label}</Text>
  </Pressable>;
}

function FieldLabel({ label, required = true }: { label: string; required?: boolean }) {
  return <View style={styles.fieldLabelRow}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {required ? <Text style={styles.fieldRequired}>필수</Text> : null}
  </View>;
}

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
      case 'ITEM_ALREADY_PENDING': return '다른 사람이 먼저 등록 요청한 매장이에요. 관리자 승인 후 원픽으로 고를 수 있어요.';
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
  const [aiMenuName, setAiMenuName] = useState('');
  const [manualCategory, setManualCategory] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  // categoryId null: the user asked for a menu that does not exist yet (등록 요청).
  const [menu, setMenu] = useState<{ categoryId: string | null; name: string } | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  // Known from the selected item row itself, before the item detail loads.
  const [itemHadPhoto, setItemHadPhoto] = useState(false);
  const [itemPending, setItemPending] = useState(false);
  const [mapLink, setMapLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSaved, setLinkSaved] = useState(false);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [review, setReview] = useState('');
  const [showReviewError, setShowReviewError] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const busy = useRef(false);

  const isNew = store?.kind === 'new';
  const storeDisplayName = store ? (store.kind === 'place' && store.branchName ? `${store.name} · ${store.branchName}` : store.name) : '';
  const storeChannel: PickChannel = store ? (store.kind === 'seller' ? 'online' : store.kind === 'place' ? 'offline' : store.channel) : channel;
  const search = useStoreSearch(channel, query, Boolean(user) && step === 1 && !requesting);
  const menus = useMenuOptions(Boolean(user) && step === 2);
  const suggestionStore = useMemo(() => store ? {
    name: store.name,
    branchName: store.kind === 'place' ? store.branchName : null,
    providerCategory: store.kind === 'place' ? store.providerCategory : null,
    region: store.kind === 'place' ? store.region : null,
    channel: storeChannel,
  } : null, [store, storeChannel]);
  const storeKey = store ? (store.kind === 'place' ? `place:${store.catalogId}` : store.kind === 'seller' ? `seller:${store.providerId}` : `new:${storeChannel}:${store.name}`) : '';
  const requestedMenu = menuQuery.trim().replace(/\s+/g, ' ');
  const availableMenus = useMemo(
    () => (menus.data ?? []).filter((option) => storeChannel === 'online' || option.placeEnabled),
    [menus.data, storeChannel],
  );
  const compactMenuName = (value: string) => value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
  const requestedMenuKey = compactMenuName(requestedMenu);
  const exactMenuMatches = requestedMenuKey
    ? availableMenus.filter((option) => compactMenuName(option.name) === requestedMenuKey).slice(0, 10)
    : [];
  const suggestions = useMenuSuggestions(
    suggestionStore,
    storeKey,
    aiMenuName,
    Boolean(user) && step === 2 && menus.isSuccess && Boolean(aiMenuName) && aiMenuName === requestedMenu && exactMenuMatches.length === 0,
  );
  useEffect(() => {
    if (step !== 2 || !menus.isSuccess || !requestedMenu || exactMenuMatches.length > 0) {
      if (!requestedMenu || exactMenuMatches.length > 0) setAiMenuName('');
      return;
    }
    const timeout = setTimeout(() => setAiMenuName(requestedMenu), 450);
    return () => clearTimeout(timeout);
  }, [step, menus.isSuccess, requestedMenu, exactMenuMatches.length]);

  const selectItem = useSelectStoreItem();
  const itemDetail = useItemDetail(itemId ?? undefined, user?.id);
  const suggestLink = useSuggestMapLink();
  const choosePhoto = useChoosePhoto();
  const choosePick = useChoosePick();
  const requestPick = useRequestPendingPick();
  const registration = useRegisterPick();
  const attachSellerLink = useAttachPendingItemLink();
  const menuHint = useSetMenuHint();

  const item = itemDetail.data?.item;
  const itemHasPhoto = Boolean(item && (item.imagePath || item.imageUrl || item.thumbnailUrl || item.imageSourceUrl));
  // v6 asks for a map link only when the user is adding a new offline store.
  const needsLink = isNew && storeChannel === 'offline';
  // A pending request cannot take a photo yet (attach_item_photo needs a reviewed item).
  const isRequest = isNew || itemPending;
  const needsPhoto = isNew || (!itemPending && !(itemHadPhoto || itemHasPhoto));
  const trimmedReview = review.trim();
  const reviewValid = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const saving = choosePick.isPending || requestPick.isPending || registration.isPending || attachSellerLink.isPending || menuHint.isPending;

  const previousFrom = (from: Step): Step => {
    if (from === 2) return needsLink ? 3 : 1;
    if (from === 3) return 1;
    if (from === 5) return needsPhoto ? 4 : 2;
    if (from === 4) return 2;
    return (from - 1) as Step;
  };
  const goBack = () => {
    if (saving || busy.current) return;
    if (step === 1 || step === 6) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    setStep(previousFrom(step));
  };

  const pickStore = (candidate: Store) => {
    if (store && storeKey !== (candidate.kind === 'place' ? `place:${candidate.catalogId}` : candidate.kind === 'seller' ? `seller:${candidate.providerId}` : `new:${candidate.channel}:${candidate.name}`)) {
      setMenu(null); setItemId(null); setItemHadPhoto(false); setItemPending(false); setLinkSaved(false); setMapLink(''); setPhoto(null);
    }
    setStore(candidate);
    setAiMenuName('');
    setManualCategory(false);
    setCategoryQuery('');
    setStep(candidate.kind === 'new' && candidate.channel === 'offline' ? 3 : 2);
  };
  const newStoreName = newName.trim().replace(/\s+/g, ' ');
  const validSellerUrl = httpsUrl(sellerUrl);
  const sellerUrlError = channel === 'online' && sellerUrl.trim() && (!validSellerUrl || isDeliveryAppUrl(sellerUrl))
    ? (isDeliveryAppUrl(sellerUrl) ? '배달앱 주문은 매장으로 골라주세요.' : 'https://로 시작하는 판매처 링크를 입력해주세요.') : null;
  const canRequest = newStoreName.length >= 1 && newStoreName.length <= 100
    && (channel === 'offline' || (Boolean(validSellerUrl) && !isDeliveryAppUrl(sellerUrl)));

  const confirmMenu = async () => {
    if (!store || !menu || busy.current) return;
    if (store.kind === 'new' || !menu.categoryId) { setStep(needsPhoto ? 4 : 5); return; }
    busy.current = true;
    try {
      const selected = await selectItem.mutateAsync({ categoryId: menu.categoryId, store });
      setItemId(selected.itemId);
      setItemHadPhoto(selected.hasPhoto);
      setItemPending(selected.pending);
      setStep(selected.hasPhoto || selected.pending ? 5 : 4);
    } catch { /* The mutation error is shown under the menu list. */ }
    finally { busy.current = false; }
  };

  const confirmLink = async (skip: boolean) => {
    setLinkError(null);
    if (skip || !mapLink.trim()) { setMapLink(skip ? '' : mapLink); setStep(2); return; }
    if (!isNaverMapUrl(mapLink)) { setLinkError('네이버 지도 링크(naver.me, map.naver.com)만 남길 수 있어요.'); return; }
    // A new store has no item yet; its link is sent right after the request is saved.
    if (isNew || !itemId) { setStep(2); return; }
    if (busy.current) return;
    busy.current = true;
    try {
      await suggestLink.mutateAsync({ itemId, url: mapLink.trim() });
      setLinkSaved(true);
      setStep(2);
    } catch (error) { setLinkError(errorMessage(error)); }
    finally { busy.current = false; }
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
          if (requestedMenu) await menuHint.mutateAsync({ userId: user.id, itemId, label: requestedMenu });
          setDone({ type: 'pending', itemName: store.name, linkSaved });
          setStep(6);
          return;
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
          if (requestedMenu) await menuHint.mutateAsync({ userId: user.id, itemId: result.item.id, label: requestedMenu });
          if (store.sellerUrl) await attachSellerLink.mutateAsync({ itemId: result.item.id, url: store.sellerUrl });
          let saved = false;
          if (mapLink.trim() && isNaverMapUrl(mapLink)) {
            saved = await suggestLink.mutateAsync({ itemId: result.item.id, url: mapLink.trim() }).then(() => true, () => false);
          }
          setDone({ type: 'pending', itemName: result.item.name, linkSaved: saved });
        }
      }
      setStep(6);
    } catch (error) {
      if (photo && isPhotoFailure(error)) showPhotoFailure(error, 'store_pick_photo_upload');
      setSaveError(error);
    } finally { busy.current = false; }
  };

  const aiAllowed = new Set(availableMenus.map((option) => option.categoryId));
  const aiSuggestions = (suggestions.data?.suggestions ?? [])
    .filter((entry) => aiAllowed.size === 0 || aiAllowed.has(entry.categoryId))
    .filter((entry) => entry.confidence !== 'low');
  const aiTried = Boolean(requestedMenu && aiMenuName === requestedMenu);
  const showManualCategory = Boolean(requestedMenu && exactMenuMatches.length === 0
    && (manualCategory || (aiTried && !suggestions.isPending && aiSuggestions.length === 0)));
  const normalizedCategoryQuery = compactMenuName(categoryQuery);
  const manualMatches = (normalizedCategoryQuery
    ? availableMenus.filter((option) => {
        const label = compactMenuName([option.groupName, option.name].filter(Boolean).join(' '));
        return label.includes(normalizedCategoryQuery);
      })
    : availableMenus).slice(0, 20);
  // No menu fits: carry on as a request. The store and the typed menu go to an
  // administrator, who picks the category; approval then makes the pick.
  const requestMenu = () => {
    if (!store || !requestedMenu || requestedMenu.length > 40) return;
    if (store.kind !== 'new') {
      setStore({
        kind: 'new',
        name: store.kind === 'place' && store.branchName ? `${store.name} ${store.branchName}` : store.name,
        channel: storeChannel,
        sellerUrl: store.kind === 'seller' ? store.officialUrl : null,
      });
      if (store.kind === 'place' && store.mapUrl) setMapLink(store.mapUrl);
    }
    setItemId(null); setItemHadPhoto(false); setItemPending(false);
    setMenu({ categoryId: null, name: requestedMenu });
    // This fallback came from a store we already identified, so v6 does not ask for a new-store link again.
    setStep(4);
  };
  const chooseMenu = (option: Pick<MenuOption, 'categoryId' | 'name'>) => {
    if (menu?.categoryId !== option.categoryId) { setItemId(null); setItemHadPhoto(false); setItemPending(false); setLinkSaved(false); }
    setMenu({ categoryId: option.categoryId, name: requestedMenu || option.name });
  };

  const cancel = () => {
    if (saving || busy.current || done) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const header = <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="이전 단계" onPress={goBack} style={styles.headerSide}>
      <Text style={styles.backText}>‹</Text>
    </Pressable>
    <Text style={styles.headerTitle}>새 원픽 등록</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록 취소" onPress={cancel} style={[styles.headerSide, styles.headerRight]}>
      <Text style={styles.headerAction}>취소</Text>
    </Pressable>
  </View>;

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.stateArea}><StateCard loading title="로그인 상태를 확인하고 있어요" /></View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.title}>새 원픽 등록</Text>
          <StateCard title="로그인하고 원픽을 등록해보세요" text="좋아하는 매장을 찾고, 메뉴와 한줄평을 남기면 내 원픽이 돼요."
            action={{ label: '로그인', variant: 'primary', onPress: () => router.push({ pathname: '/auth/login', params: { action: 'store_pick' } }) }} />
        </View>
      </ScrollView>
    </SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {header}

        {step === 1 ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>2 / 6 · {channel === 'online' ? '온라인 판매처' : '오프라인 매장'}</Text>
            <Text style={styles.title}>상호명을 검색해 주세요</Text>
            <View style={styles.channelRow}>
              <FlowChip label="매장" selected={channel === 'offline'} onPress={() => { setChannel('offline'); setRequesting(false); setQuery(''); }} />
              <FlowChip label="온라인" selected={channel === 'online'} onPress={() => { setChannel('online'); setRequesting(false); setQuery(''); }} />
            </View>
            {!requesting ? <>
              <View style={styles.fieldBlock}>
                <FieldLabel label={channel === 'online' ? '판매처명' : '상호명'} />
                <TextInput accessibilityLabel={channel === 'online' ? '판매처 이름 검색' : '매장명 검색'} autoFocus autoCapitalize="none" maxLength={100}
                  onChangeText={setQuery} value={query} returnKeyType="search" style={styles.input} placeholderTextColor={V6.tertiary}
                  placeholder={channel === 'online' ? '판매처명을 입력해 주세요' : '상호명을 입력해 주세요'} />
                {search.valid && !search.isWaiting && !search.isFetching && !search.isError && (search.data ?? []).length > 0
                  ? <Text style={styles.helper}>검색 결과 {(search.data ?? []).length}개 · {channel === 'online' ? '판매처를 확인해 주세요.' : '지점과 주소를 확인해 주세요.'}</Text>
                  : channel === 'offline' ? <Text style={styles.helper}>{PLACE_COVERAGE_NOTICE}</Text> : null}
              </View>
              {search.valid && (search.isWaiting || search.isFetching) ? <View style={styles.loading}><ActivityIndicator color={V6.text} /></View> : null}
              {search.isError ? <StateCard compact tone="danger" title="검색하지 못했어요" action={{ label: '다시 검색', onPress: () => { void search.refetch(); } }} /> : null}
              <View style={styles.results}>
                {(search.data ?? []).map((candidate) => <Pressable key={candidate.kind === 'place' ? candidate.catalogId : candidate.providerId}
                  accessibilityRole="button" accessibilityLabel={`${candidate.name} 선택`} onPress={() => pickStore(candidate)}
                  style={({ pressed }) => [styles.resultCard, pressed && styles.flowPressed]}>
                  <Text style={styles.resultTitle}>{candidate.name}{candidate.kind === 'place' && candidate.branchName ? ` · ${candidate.branchName}` : ''}</Text>
                  <Text style={styles.resultMeta} numberOfLines={1}>
                    {candidate.kind === 'place'
                      ? [candidate.region, candidate.address ? '상세 주소 표시 ›' : candidate.providerCategory].filter(Boolean).join(' · ')
                      : candidate.host}
                  </Text>
                </Pressable>)}
              </View>
              {search.valid && !search.isWaiting && !search.isFetching && !search.isError && (search.data ?? []).length === 0
                ? <Text style={styles.helper}>검색한 이름의 {channel === 'online' ? '판매처' : '매장'}를 찾지 못했어요.</Text> : null}
              <FlowButton variant="text" label="레시피는 메뉴부터 찾기" onPress={() => router.push('/pick/find')} />
            </> : <View style={styles.requestPanel}>
              <Text style={styles.panelTitle}>{channel === 'online' ? '판매처' : '매장'} 등록 요청</Text>
              <Text style={styles.helper}>찾는 곳이 없으면 이름을 직접 등록할 수 있어요.</Text>
              <View style={styles.fieldBlock}>
                <FieldLabel label={channel === 'online' ? '판매처명' : '상호명'} />
                <TextInput accessibilityLabel="등록 요청 이름" maxLength={100} value={newName} onChangeText={setNewName} style={styles.input}
                  placeholder={channel === 'online' ? '판매처 이름' : '매장 이름 (지점명 포함)'} placeholderTextColor={V6.tertiary} />
              </View>
              {channel === 'online' ? <View style={styles.fieldBlock}>
                <FieldLabel label="판매처 링크" />
                <TextInput accessibilityLabel="판매처 링크" autoCapitalize="none" keyboardType="url" maxLength={2048} value={sellerUrl}
                  onChangeText={setSellerUrl} style={styles.input} placeholder="https://…" placeholderTextColor={V6.tertiary} />
                {sellerUrlError ? <Text accessibilityRole="alert" style={styles.error}>{sellerUrlError}</Text>
                  : <Text style={styles.helper}>공식몰·스마트스토어 등 주문한 곳의 링크예요.</Text>}
              </View> : null}
            </View>}
          </View>
          <View style={styles.footer}>
            {!requesting
              ? <FlowButton variant="secondary" label={channel === 'online' ? '찾는 판매처가 없어요' : '찾는 매장이 없어요'}
                  onPress={() => { setRequesting(true); setNewName(query); }} />
              : <>
                <FlowButton label="다음" disabled={!canRequest}
                  onPress={() => pickStore({ kind: 'new', name: newStoreName, channel, sellerUrl: channel === 'online' ? validSellerUrl : null })} />
                <FlowButton variant="text" label="다시 검색하기" onPress={() => setRequesting(false)} />
              </>}
          </View>
        </> : null}

        {step === 3 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>3 / 6 · {storeDisplayName} · 오프라인 매장</Text>
            <Text style={styles.title}>매장 링크를 남겨주세요</Text>
            <View style={styles.fieldBlock}>
              <FieldLabel label="네이버 지도 링크" required={false} />
              <TextInput accessibilityLabel="네이버 지도 링크" autoCapitalize="none" keyboardType="url" maxLength={2048} value={mapLink}
                onChangeText={(value) => { setMapLink(value); setLinkError(null); }} style={styles.input}
                placeholder="https://naver.me/…" placeholderTextColor={V6.tertiary} />
              {linkError ? <Text accessibilityRole="alert" style={styles.error}>{linkError}</Text>
                : <Text style={styles.helper}>네이버 지도에서 가게를 열고 공유 → 링크 복사를 누르면 돼요.</Text>}
            </View>
          </View>
          <View style={styles.footer}>
            <FlowButton label="다음" loading={suggestLink.isPending} onPress={() => void confirmLink(false)} />
            <FlowButton variant="text" label="건너뛰기" onPress={() => void confirmLink(true)} />
          </View>
        </> : null}

        {step === 2 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>4 / 6 · {storeDisplayName} · {storeChannel === 'online' ? '온라인 판매처' : '오프라인 매장'}</Text>
            <Text style={styles.title}>어떤 메뉴인가요?</Text>
            <View style={styles.fieldBlock}>
              <FieldLabel label="메뉴명" />
              <TextInput accessibilityLabel="메뉴 이름" maxLength={40} value={menuQuery}
                onChangeText={(value) => {
                  setMenuQuery(value); setMenu(null); setAiMenuName(''); setManualCategory(false); setCategoryQuery('');
                }}
                onSubmitEditing={() => { if (menus.isSuccess && requestedMenu && exactMenuMatches.length === 0) setAiMenuName(requestedMenu); }}
                returnKeyType="search" style={styles.input} placeholder="예: 미역국" placeholderTextColor={V6.tertiary} />
              <Text style={styles.helper}>매장에서 부르는 메뉴 이름 그대로 적어 주세요. 카테고리는 입력한 이름으로 추천해 드려요.</Text>
            </View>

            {menus.isError ? <StateCard compact tone="danger" title="카테고리를 불러오지 못했어요"
              action={{ label: '다시 불러오기', onPress: () => { void menus.refetch(); } }} /> : null}

            {requestedMenu && exactMenuMatches.length > 0 ? <View style={styles.fieldBlock}>
              <FieldLabel label="카테고리" required={false} />
              <View style={styles.chips}>
                {exactMenuMatches.map((option) => <FlowChip key={option.categoryId}
                  label={[option.groupName, option.name].filter(Boolean).join(' › ')}
                  selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
              </View>
            </View> : null}

            {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiTried && suggestions.isPending ? <View style={styles.fieldBlock}>
              <FieldLabel label="카테고리" required={false} />
              <View style={styles.loadingRow}><ActivityIndicator color={V6.text} /><Text style={styles.helperInline}>메뉴명으로 카테고리를 찾고 있어요</Text></View>
            </View> : null}

            {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiTried && !suggestions.isPending && aiSuggestions.length > 0 && !showManualCategory
              ? <View style={styles.fieldBlock}>
                <FieldLabel label="카테고리 · AI 추천" required={false} />
                <View style={styles.chips}>
                  {aiSuggestions.map((entry) => <FlowChip key={entry.categoryId} label={entry.label}
                    accessibilityLabel={`AI 추천 ${entry.label}`} selected={menu?.categoryId === entry.categoryId}
                    onPress={() => chooseMenu({ categoryId: entry.categoryId, name: entry.label })} />)}
                </View>
                {aiSuggestions.find((entry) => entry.categoryId === menu?.categoryId)
                  ? <Text style={styles.helper}>{aiSuggestions.find((entry) => entry.categoryId === menu?.categoryId)?.reason}</Text> : null}
                <FlowButton variant="text" label="다른 카테고리 찾기" onPress={() => { setManualCategory(true); setMenu(null); }} />
              </View> : null}

            {showManualCategory ? <View style={styles.fieldBlock}>
              <FieldLabel label="카테고리" />
              <Text style={styles.helper}>카테고리를 추천하지 못했어요. 가까운 것을 직접 골라 주세요.</Text>
              <TextInput accessibilityLabel="카테고리 검색" value={categoryQuery} onChangeText={setCategoryQuery}
                style={styles.input} placeholder="카테고리 검색 (예: 국수)" placeholderTextColor={V6.tertiary} />
              <View style={styles.chips}>
                {manualMatches.map((option) => <FlowChip key={option.categoryId}
                  label={[option.groupName, option.name].filter(Boolean).join(' › ')}
                  selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
              </View>
              <FlowButton variant="text" label="맞는 카테고리가 없어요" onPress={requestMenu} />
            </View> : null}

            {requestedMenu && exactMenuMatches.length === 0 && !aiTried ? <View style={styles.loadingRow}>
              <ActivityIndicator color={V6.text} /><Text style={styles.helperInline}>입력이 끝나면 카테고리를 추천해 드려요</Text>
            </View> : null}
            {selectItem.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(selectItem.error)}</Text> : null}
          </View>
          <View style={styles.footer}>
            <FlowButton label="다음" disabled={!menu || suggestions.isPending} loading={selectItem.isPending} onPress={() => void confirmMenu()} />
          </View>
        </> : null}

        {step === 4 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>5 / 6 · {storeDisplayName} · {menu?.name ?? '사진'}</Text>
            <Text style={styles.title}>대표 사진을 올려주세요</Text>
            <Text style={styles.helper}>같은 원픽을 고른 사람들의 카드에도 함께 보여요. 사진이 없어도 괜찮아요.</Text>
            {isNew ? <View style={styles.photoPanel}>
              {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" /> : null}
              <FlowButton variant="secondary" label={photo ? '사진 바꾸기' : '사진 선택'} loading={choosePhoto.isPending} onPress={() => void pickNewPhoto()} />
              {photo ? <FlowButton variant="text" label="사진 빼기" onPress={() => setPhoto(null)} /> : null}
            </View> : itemId && user && !itemHasPhoto ? <PickPhotoStep userId={user.id} itemId={itemId} onAttached={() => { void itemDetail.refetch(); }} />
              : itemHasPhoto ? <StateCard compact title="사진이 등록됐어요" /> : null}
          </View>
          <View style={styles.footer}>
            <FlowButton label="다음" onPress={() => setStep(5)} />
            {!photo && !itemHasPhoto ? <FlowButton variant="text" label="사진 없이 계속" onPress={() => setStep(5)} /> : null}
          </View>
        </> : null}

        {(step === 5 || step === 6) && store && menu ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>6 / 6 · {storeDisplayName} · {menu.name}</Text>
            <Text style={styles.title}>한줄평을 남겨주세요</Text>
            {!itemPending && itemDetail.data?.myPickStatus?.type === 'selected_other'
              ? <View style={styles.notice}><Text style={styles.noticeText}>저장하면 이 메뉴의 {storeChannel === 'online' ? '온라인' : '매장'} 원픽이 이걸로 바뀌고, 이전 선택은 기록으로 남아요.</Text></View> : null}
            <View style={styles.fieldBlock}>
              <FieldLabel label="한줄평" />
              <TextInput accessibilityLabel="원픽 한줄평" multiline maxLength={100} editable={!saving && step !== 6} value={review}
                onChangeText={(value) => { setReview(value); setShowReviewError(false); }} style={[styles.input, styles.reviewInput]}
                placeholder="예: 국물이 진한데 부담스럽지 않아요." placeholderTextColor={V6.tertiary} />
            </View>
            <Text style={styles.counter}>{review.length} / 100자</Text>
            {showReviewError && !reviewValid ? <Text accessibilityRole="alert" style={styles.error}>한줄평을 1~100자로 입력해주세요.</Text> : null}
            {isRequest ? <Text style={styles.helper}>등록 확인이 필요한 경우 확인이 끝나면 이 한줄평으로 내 원픽에 반영돼요.</Text> : null}
            {saveError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(saveError)}</Text> : null}
          </View>
          <View style={styles.footer}>
            <FlowButton label="원픽 등록하기" loading={saving} disabled={step === 6} onPress={() => void save()} />
          </View>
        </> : null}
      </ScrollView>

      <Modal transparent visible={step === 6 && Boolean(done)} animationType="fade" onRequestClose={() => {}}>
        <View style={styles.overlay}>
          {done && store && menu ? <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{done.type === 'pick' ? '원픽을 정했어요' : '등록 요청을 보냈어요'}</Text>
            <Text style={styles.dialogBody}>{done.type === 'pick'
              ? `${storeDisplayName} ${menu.name}이 내 원픽이 됐어요.`
              : `${storeDisplayName} ${menu.name} 등록 요청을 보냈어요.`}</Text>
            <View style={styles.dialogSpacer} />
            <FlowButton label="확인" onPress={() => {
              if (done.type === 'pick') router.replace({ pathname: '/item/[itemId]', params: { itemId: done.itemId, pickId: done.pickId } });
              else router.replace('/(tabs)/profile');
            }} />
          </View> : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: V6.background },
  stateArea: { padding: 16 },
  content: { flexGrow: 1, width: '100%', maxWidth: 390, alignSelf: 'center' },
  header: {
    height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    backgroundColor: V6.background,
  },
  headerSide: { width: 48, height: 56, justifyContent: 'center', alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end' },
  backText: { color: V6.text, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  headerTitle: { flex: 1, color: V6.text, fontSize: 16, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  headerAction: { color: V6.text, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  body: { flexGrow: 1, gap: 12, paddingTop: 12, paddingHorizontal: 16 },
  footer: { gap: 8, marginTop: 'auto', paddingTop: 16, paddingHorizontal: 16, paddingBottom: 24 },
  stepMeta: { color: V6.secondary, fontSize: 12, lineHeight: 18, fontWeight: '400' },
  title: { color: V6.text, fontSize: 22, lineHeight: 30, fontWeight: '700' },
  channelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldBlock: { gap: 8 },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  fieldLabel: { color: V6.secondary, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  fieldRequired: { color: V6.accent, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  input: {
    height: 52, borderWidth: 0, borderRadius: 12, backgroundColor: V6.subtle,
    paddingHorizontal: 16, paddingVertical: 12, color: V6.text, fontSize: 14, lineHeight: 21, fontWeight: '400',
  },
  reviewInput: { height: 120, padding: 16, textAlignVertical: 'top' },
  helper: { color: V6.secondary, fontSize: 12, lineHeight: 18, fontWeight: '400' },
  helperInline: { color: V6.secondary, fontSize: 12, lineHeight: 18, fontWeight: '400' },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18 },
  loading: { paddingVertical: 16, alignItems: 'center' },
  loadingRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  results: { gap: 8 },
  resultCard: {
    minHeight: 60, justifyContent: 'center', gap: 2, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12, backgroundColor: V6.subtle,
  },
  resultTitle: { color: V6.text, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  resultMeta: { color: V6.secondary, fontSize: 12, lineHeight: 18, fontWeight: '400' },
  requestPanel: { gap: 12 },
  panelTitle: { color: V6.text, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flowChip: {
    minHeight: 32, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12,
    borderRadius: 999, backgroundColor: V6.muted,
  },
  flowChipSelected: { backgroundColor: V6.text },
  flowChipLabel: { color: V6.text, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  flowChipLabelSelected: { color: V6.onAction },
  flowButton: {
    alignSelf: 'stretch', minHeight: 52, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, borderRadius: 12, backgroundColor: V6.text,
  },
  flowButtonSecondary: { backgroundColor: V6.background, borderWidth: 1, borderColor: V6.borderStrong },
  flowButtonText: { minHeight: 40, paddingHorizontal: 0, backgroundColor: 'transparent' },
  flowButtonDisabled: { backgroundColor: V6.disabled, borderWidth: 0 },
  flowButtonLabel: { color: V6.onAction, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  flowButtonLabelDark: { color: V6.text },
  flowPressed: { opacity: 0.88 },
  photoPanel: { gap: 12 },
  preview: { width: '100%', height: 220, borderRadius: 12, backgroundColor: V6.subtle },
  notice: { padding: 12, borderRadius: 12, backgroundColor: '#FFF0DC' },
  noticeText: { color: V6.text, fontSize: 12, lineHeight: 18 },
  counter: { alignSelf: 'stretch', color: V6.tertiary, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: V6.overlay },
  dialog: { width: 300, alignItems: 'center', gap: 8, padding: 24, borderRadius: 16, backgroundColor: V6.background },
  dialogTitle: { color: V6.text, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  dialogBody: { color: V6.secondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  dialogSpacer: { height: 8 },
});
