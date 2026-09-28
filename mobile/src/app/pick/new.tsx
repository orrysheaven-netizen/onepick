import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickPhotoStep } from '@/components/pick-photo-step';
import { Button, Chip, StateCard } from '@/components/ui';
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

const STEP_LABELS = ['매장', '메뉴', '링크', '사진', '한줄평', '완료'];

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
  const storeName = store ? store.name : '';
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
  const menuMatches = requestedMenuKey
    ? availableMenus.filter((option) => {
        const name = compactMenuName(option.name);
        return name.includes(requestedMenuKey) || requestedMenuKey.includes(name);
      }).slice(0, 30)
    : [];
  const suggestions = useMenuSuggestions(
    suggestionStore,
    storeKey,
    aiMenuName,
    Boolean(user) && step === 2 && menus.isSuccess && Boolean(aiMenuName) && aiMenuName === requestedMenu && exactMenuMatches.length === 0,
  );
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
  // Online sellers already carry their shop link; a store with an approved map link needs none.
  const needsLink = storeChannel === 'offline' && !(store?.kind === 'place' && store.mapUrl);
  // A pending request cannot take a photo yet (attach_item_photo needs a reviewed item).
  const isRequest = isNew || itemPending;
  const needsPhoto = isNew || (!itemPending && !(itemHadPhoto || itemHasPhoto));
  const trimmedReview = review.trim();
  const reviewValid = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const saving = choosePick.isPending || requestPick.isPending || registration.isPending || attachSellerLink.isPending || menuHint.isPending;

  const nextFrom = (from: Step): Step => {
    if (from === 2) return needsLink ? 3 : needsPhoto ? 4 : 5;
    if (from === 3) return needsPhoto ? 4 : 5;
    return (from + 1) as Step;
  };
  const previousFrom = (from: Step): Step => {
    if (from === 5) return needsPhoto ? 4 : needsLink ? 3 : 2;
    if (from === 4) return needsLink ? 3 : 2;
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
    setStep(2);
  };
  const newStoreName = newName.trim().replace(/\s+/g, ' ');
  const validSellerUrl = httpsUrl(sellerUrl);
  const sellerUrlError = channel === 'online' && sellerUrl.trim() && (!validSellerUrl || isDeliveryAppUrl(sellerUrl))
    ? (isDeliveryAppUrl(sellerUrl) ? '배달앱 주문은 매장으로 골라주세요.' : 'https://로 시작하는 판매처 링크를 입력해주세요.') : null;
  const canRequest = newStoreName.length >= 1 && newStoreName.length <= 100
    && (channel === 'offline' || (Boolean(validSellerUrl) && !isDeliveryAppUrl(sellerUrl)));

  const confirmMenu = async () => {
    if (!store || !menu || busy.current) return;
    if (store.kind === 'new' || !menu.categoryId) { setStep(nextFrom(2)); return; }
    busy.current = true;
    try {
      const selected = await selectItem.mutateAsync({ categoryId: menu.categoryId, store });
      setItemId(selected.itemId);
      setItemHadPhoto(selected.hasPhoto);
      setItemPending(selected.pending);
      setStep(needsLink ? 3 : selected.hasPhoto || selected.pending ? 5 : 4);
    } catch { /* The mutation error is shown under the menu list. */ }
    finally { busy.current = false; }
  };

  const confirmLink = async (skip: boolean) => {
    setLinkError(null);
    if (skip || !mapLink.trim()) { setMapLink(skip ? '' : mapLink); setStep(nextFrom(3)); return; }
    if (!isNaverMapUrl(mapLink)) { setLinkError('네이버 지도 링크(naver.me, map.naver.com)만 남길 수 있어요.'); return; }
    // A new store has no item yet; its link is sent right after the request is saved.
    if (isNew || !itemId) { setStep(nextFrom(3)); return; }
    if (busy.current) return;
    busy.current = true;
    try {
      await suggestLink.mutateAsync({ itemId, url: mapLink.trim() });
      setLinkSaved(true);
      setStep(nextFrom(3));
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
    setStep(storeChannel === 'offline' ? 3 : 4);
  };
  const chooseMenu = (option: Pick<MenuOption, 'categoryId' | 'name'>) => {
    if (menu?.categoryId !== option.categoryId) { setItemId(null); setItemHadPhoto(false); setItemPending(false); setLinkSaved(false); }
    setMenu({ categoryId: option.categoryId, name: requestedMenu || option.name });
  };

  const header = <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="이전 단계" onPress={goBack} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
    <View style={styles.progress} accessibilityLabel={`${step} / 6 단계 · ${STEP_LABELS[step - 1]}`}>
      {STEP_LABELS.map((label, index) => <View key={label} style={[styles.progressBar, index < step && styles.progressOn]} />)}
    </View>
    <Text style={styles.stepLabel}>{step} / 6 · {STEP_LABELS[step - 1]}</Text>
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
          <Text style={styles.title}>어느 {channel === 'online' ? '판매처' : '매장'}인가요?</Text>
          <Text style={styles.subtitle}>{channel === 'online' ? '택배·온라인몰로 주문한 판매처 이름을 검색해주세요.' : '가게 이름을 검색하고 지점을 골라주세요.'}</Text>
          <View style={styles.chips}>
            <Chip label="매장" selected={channel === 'offline'} onPress={() => { setChannel('offline'); setRequesting(false); }} />
            <Chip label="온라인" selected={channel === 'online'} onPress={() => { setChannel('online'); setRequesting(false); }} />
          </View>
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
              <Text style={styles.helper}>찾는 {channel === 'online' ? '판매처' : '매장'}가 없나요? <Text style={styles.link}>{channel === 'online' ? '판매처' : '매장'} 등록 요청</Text></Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push('/pick/find')} style={styles.requestLink}>
              <Text style={styles.helper}>레시피 원픽은 <Text style={styles.link}>메뉴부터 찾기</Text></Text>
            </Pressable>
          </> : <View style={styles.card}>
            <Text style={styles.cardTitle}>{channel === 'online' ? '판매처' : '매장'} 등록 요청</Text>
            <Text style={styles.helper}>관리자가 확인한 뒤 등록돼요. 승인되면 이어서 남긴 한줄평으로 내 원픽이 자동 등록돼요.</Text>
            <TextInput accessibilityLabel="등록 요청 이름" maxLength={100} value={newName} onChangeText={setNewName} style={styles.input}
              placeholder={channel === 'online' ? '판매처 이름' : '매장 이름 (지점명 포함)'} placeholderTextColor={OnePick.hint} />
            {channel === 'online' ? <>
              <TextInput accessibilityLabel="판매처 링크" autoCapitalize="none" keyboardType="url" maxLength={2048} value={sellerUrl}
                onChangeText={setSellerUrl} style={styles.input} placeholder="https://…" placeholderTextColor={OnePick.hint} />
              {sellerUrlError ? <Text accessibilityRole="alert" style={styles.error}>{sellerUrlError}</Text>
                : <Text style={styles.helper}>공식몰·스마트스토어 등 주문한 곳의 링크예요.</Text>}
            </> : null}
            <Button fullWidth label="다음" disabled={!canRequest} onPress={() => pickStore({ kind: 'new', name: newStoreName, channel, sellerUrl: channel === 'online' ? validSellerUrl : null })} style={styles.primary} />
            <Button variant="ghost" size="sm" label="다시 검색하기" onPress={() => setRequesting(false)} />
          </View>}
        </> : null}

        {step === 2 && store ? <>
          <Text style={styles.title}>어떤 메뉴인가요?</Text>
          <Text style={styles.subtitle}>{store.name}에서 고른 메뉴 이름을 입력해주세요. 같은 메뉴가 있으면 바로 보여드리고, 없으면 AI가 카테고리를 추천해요.</Text>
          <TextInput accessibilityLabel="메뉴 이름" maxLength={40} value={menuQuery} onChangeText={(value) => { setMenuQuery(value); setMenu(null); setAiMenuName(''); }}
            onSubmitEditing={() => { if (menus.isSuccess && requestedMenu && exactMenuMatches.length === 0) setAiMenuName(requestedMenu); }} returnKeyType="search" style={styles.input}
            placeholder="예: 평양냉면, 도가니탕" placeholderTextColor={OnePick.hint} />
          {requestedMenu && exactMenuMatches.length > 0 ? <>
            <Text style={styles.section}>같은 메뉴</Text>
            <View style={styles.chips}>
              {exactMenuMatches.map((option) => <Chip key={option.categoryId} label={option.name} selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
            </View>
          </> : null}
          {requestedMenu && exactMenuMatches.length === 0 && menuMatches.length > 0 ? <>
            <Text style={styles.section}>비슷한 기존 메뉴</Text>
            <View style={styles.chips}>
              {menuMatches.map((option) => <Chip key={option.categoryId} label={option.name} selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
            </View>
          </> : null}
          {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 ? <>
            <Text style={styles.section}>AI 카테고리 추천</Text>
            {aiMenuName !== requestedMenu ? <Button variant="secondary" label="AI로 카테고리 추천받기" onPress={() => setAiMenuName(requestedMenu)} /> : null}
          </> : null}
          {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiMenuName === requestedMenu && suggestions.isPending ? <View style={styles.loadingRow}><ActivityIndicator color={OnePick.accent} /><Text style={styles.helper}>메뉴 카테고리를 추천하고 있어요</Text></View>
            : menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiMenuName === requestedMenu && aiSuggestions.length ? <View style={styles.chips}>
              {aiSuggestions.map((entry) => <Chip key={entry.categoryId} label={entry.label.split(' › ').pop() ?? entry.label}
                accessibilityLabel={`AI 추천 ${entry.label}`} selected={menu?.categoryId === entry.categoryId}
                onPress={() => chooseMenu({ categoryId: entry.categoryId, name: entry.label.split(' › ').pop() ?? entry.label })} />)}
            </View>
            : menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiMenuName === requestedMenu && !suggestions.isPending ? <Text style={styles.helper}>{suggestions.isError ? 'AI 추천을 불러오지 못했어요. 아래 수동 목록에서 골라주세요.' : '추천할 카테고리를 찾지 못했어요. 아래 수동 목록에서 골라주세요.'}</Text> : null}
          {aiSuggestions.find((entry) => entry.categoryId === menu?.categoryId)
            ? <Text style={styles.helper}>{aiSuggestions.find((entry) => entry.categoryId === menu?.categoryId)?.reason}</Text> : null}
          {requestedMenu && exactMenuMatches.length === 0 ? <Text style={styles.section}>수동 목록</Text> : null}
          {menus.isError ? <StateCard compact tone="danger" title="메뉴를 불러오지 못했어요" action={{ label: '다시 불러오기', onPress: () => { void menus.refetch(); } }} /> : null}
          {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 ? <View style={styles.chips}>
            {availableMenus.slice(0, 30).map((option) => <Chip key={option.categoryId} label={option.name} selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
          </View> : null}
          {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiMenuName === requestedMenu && !suggestions.isPending && !menu ? <View style={styles.card}>
            <Text style={styles.cardTitle}>'{requestedMenu}' 메뉴가 아직 없어요</Text>
            <Text style={styles.helper}>이 메뉴로 등록 요청을 보내면 관리자가 메뉴를 추가해 승인하고, 이어서 남긴 한줄평으로 내 원픽이 자동 등록돼요.</Text>
            {requestedMenu.length > 40 ? <Text accessibilityRole="alert" style={styles.error}>메뉴 이름은 40자까지 적을 수 있어요.</Text> : null}
            <Button fullWidth label={`'${requestedMenu}' 메뉴로 등록 요청`} disabled={requestedMenu.length > 40} onPress={requestMenu} style={styles.primary} />
          </View> : null}
          {selectItem.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(selectItem.error)}</Text> : null}
          <Button fullWidth size="lg" label={menu ? `${menu.name}(으)로 다음` : '메뉴를 골라주세요'} disabled={!menu}
            loading={selectItem.isPending} onPress={() => void confirmMenu()} style={styles.primary} />
        </> : null}

        {step === 3 && store ? <>
          <Text style={styles.title}>네이버 지도 링크를 남겨주세요</Text>
          <Text style={styles.subtitle}>다른 사람들이 {store.name}을(를) 바로 찾아갈 수 있어요. 관리자가 확인한 뒤 표시돼요.</Text>
          <TextInput accessibilityLabel="네이버 지도 링크" autoCapitalize="none" keyboardType="url" maxLength={2048} value={mapLink}
            onChangeText={(value) => { setMapLink(value); setLinkError(null); }} style={styles.input} placeholder="https://naver.me/…" placeholderTextColor={OnePick.hint} />
          {linkError ? <Text accessibilityRole="alert" style={styles.error}>{linkError}</Text>
            : <Text style={styles.helper}>네이버 지도에서 가게를 열고 공유 → 링크 복사를 누르면 돼요.</Text>}
          <Button fullWidth size="lg" label="다음" loading={suggestLink.isPending} onPress={() => void confirmLink(false)} style={styles.primary} />
          <Button variant="ghost" label="건너뛰기" onPress={() => void confirmLink(true)} />
        </> : null}

        {step === 4 && store ? <>
          <Text style={styles.title}>대표 사진을 올려주세요</Text>
          <Text style={styles.subtitle}>같은 원픽을 고른 사람들의 카드에도 함께 보여요. 사진이 없어도 괜찮아요.</Text>
          {isNew ? <View style={styles.card}>
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" /> : null}
            <Button fullWidth variant="soft" label={photo ? '사진 바꾸기' : '사진 선택'} loading={choosePhoto.isPending} onPress={() => void pickNewPhoto()} />
            {photo ? <Button variant="ghost" size="sm" label="사진 빼기" onPress={() => setPhoto(null)} /> : null}
          </View> : itemId && user && !itemHasPhoto ? <PickPhotoStep userId={user.id} itemId={itemId} onAttached={() => { void itemDetail.refetch(); }} />
            : itemHasPhoto ? <StateCard compact title="사진이 등록됐어요" /> : null}
          <Button fullWidth size="lg" label="다음" onPress={() => setStep(5)} style={styles.primary} />
          {!photo && !itemHasPhoto ? <Button variant="ghost" label="사진 없이 계속" onPress={() => setStep(5)} /> : null}
        </> : null}

        {step === 5 && store && menu ? <>
          <Text style={styles.title}>왜 여기가 원픽인가요?</Text>
          <Text style={styles.subtitle}>{store.name} · {menu.name}</Text>
          {!itemPending && itemDetail.data?.myPickStatus?.type === 'selected_other'
            ? <View style={styles.notice}><Text style={styles.noticeText}>저장하면 이 메뉴의 {storeChannel === 'online' ? '온라인' : '매장'} 원픽이 이걸로 바뀌고, 이전 선택은 기록으로 남아요.</Text></View> : null}
          <View style={styles.reviewHeader}><Text style={styles.section}>한 줄 이유 <Text style={styles.required}>필수</Text></Text><Text style={styles.counter}>{review.length}/100</Text></View>
          <TextInput accessibilityLabel="원픽 한줄평" multiline maxLength={100} editable={!saving} value={review}
            onChangeText={(value) => { setReview(value); setShowReviewError(false); }} style={[styles.input, styles.reviewInput]}
            placeholder="예: 육수가 깔끔해서 계속 생각나요" placeholderTextColor={OnePick.hint} />
          {showReviewError && !reviewValid ? <Text accessibilityRole="alert" style={styles.error}>한줄평을 1~100자로 입력해주세요.</Text> : null}
          {isRequest ? <Text style={styles.helper}>관리자가 {store.name}을(를) 확인해 승인하면 이 한줄평으로 내 원픽에 자동 등록돼요.</Text> : null}
          {saveError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(saveError)}</Text> : null}
          <Button fullWidth size="lg" label={isRequest ? '등록 요청하고 원픽 남기기' : '원픽 등록'} loading={saving} onPress={() => void save()} style={styles.primary} />
        </> : null}

        {step === 6 && done && store && menu ? <View style={styles.doneCard}>
          <Text style={styles.doneMark}>✓</Text>
          <Text style={styles.title}>{done.type === 'pick' ? '원픽을 정했어요' : '등록 요청을 보냈어요'}</Text>
          <Text style={styles.subtitle}>{store.name} · {menu.name}</Text>
          <Text style={styles.savedReview}>“{trimmedReview}”</Text>
          {done.type === 'pending' ? <Text style={styles.helper}>관리자가 확인해 승인하면 이 한줄평으로 내 원픽에 자동 등록되고, 알림으로 알려드려요.</Text> : null}
          {linkSaved || (done.type === 'pending' && done.linkSaved) ? <Text style={styles.helper}>남겨주신 네이버 지도 링크는 확인 후 표시돼요.</Text> : null}
          {done.type === 'pick'
            ? <Button fullWidth size="lg" label="내 원픽 보기" onPress={() => router.replace({ pathname: '/item/[itemId]', params: { itemId: done.itemId, pickId: done.pickId } })} style={styles.primary} />
            : <Button fullWidth size="lg" label="내 등록 요청 보기" onPress={() => router.replace('/(tabs)/profile')} style={styles.primary} />}
          <Button variant="ghost" label="홈으로" onPress={() => router.replace('/')} />
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 48 },
  header: { marginTop: 4 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8, paddingLeft: 8 },
  backText: { color: OnePick.text, fontSize: 34, lineHeight: 38, fontWeight: '300' },
  progress: { flexDirection: 'row', gap: 4, marginTop: 4 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: OnePick.border },
  progressOn: { backgroundColor: OnePick.accent },
  stepLabel: { color: OnePick.muted, fontSize: 12, marginTop: 8 },
  title: { color: OnePick.text, fontSize: 24, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5, marginTop: 14 },
  subtitle: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
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
  preview: { width: '100%', height: 220, borderRadius: 12, marginBottom: 12, backgroundColor: OnePick.background },
  primary: { marginTop: 22 },
  doneCard: { alignItems: 'center', paddingTop: 30 },
  doneMark: { color: OnePick.accent, fontSize: 36, fontWeight: '800' },
  savedReview: { color: OnePick.text, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 },
});
