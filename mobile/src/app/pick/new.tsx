import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCard } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useChoosePhoto, useReadCurrentPickSlot, useRegisterItemPick } from '@/hooks/useRegisterPick';
import { useMenuOptions, useMenuSuggestions, useSelectStoreItem, useStoreSearch } from '@/hooks/useStoreFirst';
import { PLACE_COVERAGE_NOTICE, type PickChannel } from '@/lib/items/pickChannel';
import { armPickSavedToast } from '@/lib/items/pickSavedToast';
import { isPhotoFailure, showPhotoFailure } from '@/lib/photos/photoFailure';
import { pickDraftStore, type PickDraftStep, type RestoredPickDraft } from '@/lib/pick/pickDraft';
import { isNaverMapUrl, type MenuOption, type StoreCandidate, type StoreSelection } from '@/services/storeFirstService';
import type { PickPhotoDraft } from '@/types/domain/photo';

// 원픽 등록 4단계: 매장 → 메뉴 → 사진 → 한줄평. 지도 링크는 매장 단계 안에서 받는다.
// Everything the user enters lives in this one screen's state, so moving back
// and forth between steps never loses a typed review or a chosen photo. The same
// state is mirrored to an account-bound draft (lib/pick/pickDraft) so a login round
// trip in this writing session returns to it (#475); server state is re-checked.

type Step = 1 | 2 | 4 | 5 | 6;
type NewStore = { kind: 'new'; name: string; channel: 'offline'; mapUrl: string };
type Store = StoreCandidate | NewStore;
type Done = { pickId: string; itemId: string };


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
    {loading ? <ActivityIndicator color={variant === 'primary' ? OnePick.onAction : OnePick.textPrimary} />
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

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'AUTH_REQUIRED': return '로그인이 만료됐어요. 다시 로그인한 뒤 이어가주세요.';
      case 'PROFILE_NOT_FOUND': return '원픽을 남기려면 사용자명을 먼저 정해주세요.';
      case 'CATEGORY_NOT_PICKABLE': return '이 메뉴는 지금 고를 수 없어요. 다른 메뉴를 골라주세요.';
      case 'ITEM_NOT_ELIGIBLE':
      case 'ITEM_NOT_FOUND': return '지금은 이 매장을 원픽으로 고를 수 없어요.';
      case 'ITEM_ALREADY_PENDING': return '다른 사람이 먼저 등록한 항목이에요. 잠시 후 다시 확인해주세요.';
      case 'ITEM_LINK_REQUIRED': return '이 원픽을 바로 확인할 수 있는 링크를 입력해주세요.';
      case 'PROVIDER_NOT_FOUND': return '이 판매처는 지금 고를 수 없어요.';
      case 'BRAND_NOT_FOUND': return '이 브랜드는 지금 고를 수 없어요.';
      case 'REVIEW_INVALID': return '한줄평을 1~100자로 입력해주세요.';
      case 'ITEM_NAME_INVALID':
      case 'PLACE_NAME_INVALID': return '매장 이름을 1~100자로 입력해주세요.';
      case 'LINK_INVALID': return '네이버 지도 링크(naver.me, map.naver.com)만 남길 수 있어요.';
      case 'RATE_LIMITED': return '요청이 많아요. 잠시 후 다시 시도해주세요.';
      case 'PICK_COOLDOWN': return '해제한 원픽은 24시간이 지나야 다시 고를 수 있어요.';
      case 'PICK_CHANGED_ELSEWHERE': return '다른 기기에서 원픽이 바뀌었어요. 최신 선택을 확인한 뒤 다시 등록해주세요.';
      case 'USER_SUSPENDED': return '현재 계정에서는 원픽을 등록할 수 없어요.';
      case 'PHOTO_REQUIRED': return '대표 사진을 올려주세요.';
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
  const [query, setQuery] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestPart, setRequestPart] = useState<'name' | 'link'>('name');
  const [newName, setNewName] = useState('');
  const [store, setStore] = useState<Store | null>(null);
  const [menuQuery, setMenuQuery] = useState('');
  const [aiMenuName, setAiMenuName] = useState('');
  const [manualCategory, setManualCategory] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [menu, setMenu] = useState<{ categoryId: string | null; name: string } | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  // Known from the selected item row itself, before the item detail loads.
  const [itemHadPhoto, setItemHadPhoto] = useState(false);
  const [itemPending, setItemPending] = useState(false);
  const [preflight, setPreflight] = useState<StoreSelection | null>(null);
  const [pickScope, setPickScope] = useState<'branch' | 'brand' | null>(null);
  const [mapLink, setMapLink] = useState('');
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [review, setReview] = useState('');
  const [showReviewError, setShowReviewError] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [pickChangedElsewhere, setPickChangedElsewhere] = useState(false);
  // undefined = the current Pick slot has not been shown/read for this menu yet;
  // null = the slot was empty when the person confirmed the menu.
  const [expectedPreviousPickId, setExpectedPreviousPickId] = useState<string | null | undefined>(undefined);
  const busy = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  // Account whose draft this screen has loaded; null until the session resolves.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  // Saved step 3/4 to return to after the menu selection is re-checked on the server.
  const [resumeStep, setResumeStep] = useState<PickDraftStep | null>(null);
  // A photo was chosen before the round trip but could not be kept.
  const [photoReselect, setPhotoReselect] = useState(false);
  const drafts = pickDraftStore();

  const resetForm = () => {
    setStep(1); setQuery(''); setRequesting(false); setRequestPart('name'); setNewName(''); setStore(null);
    setMenuQuery(''); setAiMenuName(''); setManualCategory(false); setCategoryQuery(''); setMenu(null);
    setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null);
    setMapLink(''); setPhoto(null); setReview(''); setShowReviewError(false); setDone(null); setSaveError(null);
    setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
    setResumeStep(null); setPhotoReselect(false);
  };
  const applyDraft = (draft: RestoredPickDraft) => {
    setQuery(draft.query); setRequesting(draft.requesting); setRequestPart(draft.requestPart ?? 'name'); setNewName(draft.newName);
    setMapLink(draft.mapLink); setStore(draft.store as Store | null); setMenuQuery(draft.menuQuery);
    setManualCategory(draft.manualCategory); setCategoryQuery(draft.categoryQuery); setMenu(draft.menu);
    setPickScope(draft.pickScope); setReview(draft.review); setPhoto(draft.photo); setPhotoReselect(draft.photoLost);
    // Item, photo requirement and the current Pick slot come from the server again:
    // later steps resume only after the menu step's own checks pass (never auto-submit).
    if (draft.step >= 4 && draft.store && draft.menu) { setStep(2); setResumeStep(draft.step); }
    else setStep(draft.step >= 4 ? (draft.store ? 2 : 1) : draft.step);
  };
  // Load once per resolved account. Nothing is read while the session is still being
  // checked, and a different account first gets an empty form (its predecessor's
  // in-memory input is dropped and the stored draft is discarded by load()).
  if (!auth.isLoading && user && hydratedFor !== user.id) {
    if (hydratedFor !== null) resetForm();
    setHydratedFor(user.id);
    const draft = drafts.load(user.id);
    if (draft) applyDraft(draft);
  }

  const storeDisplayName = store ? (store.kind === 'place' && store.branchName ? `${store.name} · ${store.branchName}` : store.name) : '';
  const pickDisplayName = pickScope === 'brand' && preflight?.brand ? `${preflight.brand.name} 전체` : storeDisplayName;
  const storeChannel: PickChannel = store?.kind === 'seller' ? 'online' : 'offline';
  const search = useStoreSearch('offline', query, Boolean(user) && step === 1 && !requesting);
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
  const availableMenus = useMemo(() => (menus.data ?? []).filter((option) => option.placeEnabled), [menus.data]);
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

  const draftOwner = user && hydratedFor === user.id ? user.id : null;
  useEffect(() => {
    if (!draftOwner || done) return;
    drafts.save(draftOwner, {
      step: resumeStep ?? (step === 6 ? 5 : step), query, requesting, requestPart, newName, mapLink, store,
      menuQuery, manualCategory, categoryQuery, menu, pickScope, review,
    });
  }, [draftOwner, done, resumeStep, step, query, requesting, requestPart, newName, mapLink, store, menuQuery,
    manualCategory, categoryQuery, menu, pickScope, review]);
  useEffect(() => {
    // Keep a 'lost' marker until a new photo is chosen, so a second round trip still asks.
    if (!draftOwner || done || (!photo && photoReselect)) return;
    drafts.savePhoto(draftOwner, photo);
  }, [draftOwner, done, photo, photoReselect]);

  const selectItem = useSelectStoreItem();
  const itemDetail = useItemDetail(itemId ?? undefined, user?.id);
  const choosePhoto = useChoosePhoto();
  const currentPickSlot = useReadCurrentPickSlot();
  const registration = useRegisterItemPick();

  const item = itemDetail.data?.item;
  const itemHasPhoto = Boolean(item && (item.imagePath || item.imageUrl || item.thumbnailUrl || item.imageSourceUrl));
  const needsPhoto = !(itemHadPhoto || itemHasPhoto);
  const trimmedReview = review.trim();
  const reviewValid = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const saving = registration.isPending;
  const replacingVisiblePick = expectedPreviousPickId !== undefined && expectedPreviousPickId !== null
    && itemDetail.data?.myPickStatus?.type !== 'selected_this';

  const previousFrom = (from: Step): Step => {
    if (from === 2) return 1;
    if (from === 4) return 2;
    if (from === 5) return 4;
    return 5;
  };
  const goBack = () => {
    if (saving || busy.current) return;
    if (step === 6) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    if (step === 1 && requesting && requestPart === 'link') { setRequestPart('name'); return; }
    if (step === 1 && requesting) { setRequesting(false); return; }
    if (step === 1) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    setStep(previousFrom(step));
  };
  const pickStore = (candidate: Store) => {
    if (store && storeKey !== (candidate.kind === 'place' ? `place:${candidate.catalogId}` : candidate.kind === 'seller' ? `seller:${candidate.providerId}` : `new:offline:${candidate.name}`)) {
      setMenu(null); setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null); setPhoto(null);
      setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
    }
    setStore(candidate);
    setAiMenuName('');
    setManualCategory(false);
    setCategoryQuery('');
    setStep(2);
  };
  const newStoreName = newName.trim().replace(/\s+/g, ' ');
  const validMapLink = isNaverMapUrl(mapLink);
  const validNewName = newStoreName.length >= 1 && newStoreName.length <= 100;
  const canRequest = validNewName && validMapLink;

  const readCurrentSlotSnapshot = async (categoryId: string) => {
    if (!user) throw new AppError('AUTH_REQUIRED');
    const current = await currentPickSlot.mutateAsync({ userId: user.id, categoryId, channel: storeChannel });
    const snapshot = current?.id ?? null;
    setExpectedPreviousPickId(snapshot);
    return snapshot;
  };

  const confirmMenu = async (resume?: PickDraftStep) => {
    if (!user || !store || !effectiveMenu || busy.current) return;
    // A restored review step stays there only when no photo is missing.
    const photoStep = (next: 4 | 5): Step => (resume === 5 && next === 4 && photo ? 5 : next);
    if (!menu) setMenu(effectiveMenu);
    if (!effectiveMenu.categoryId) return;

    busy.current = true;
    try {
      if (store.kind === 'new') {
        await readCurrentSlotSnapshot(effectiveMenu.categoryId);
        setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope('branch'); setStep(photoStep(4));
        return;
      }

      let selected = preflight?.categoryId === effectiveMenu.categoryId ? preflight : null;
      if (!selected) {
        selected = await selectItem.mutateAsync({ categoryId: effectiveMenu.categoryId, store });
        setPreflight(selected);
      }
      if (selected.brand && !pickScope) return;

      const target = pickScope === 'brand' && selected.brand ? selected.brand : selected;
      await readCurrentSlotSnapshot(effectiveMenu.categoryId);
      setItemId(target.itemId);
      setItemHadPhoto(target.hasPhoto);
      setItemPending(target.pending);
      setStep(target.hasPhoto ? 5 : photoStep(4));
    } catch { /* Each mutation exposes its own error under the menu controls. */ }
    finally { busy.current = false; }
  };

  useEffect(() => {
    if (resumeStep === null || !user || step !== 2) return;
    const target = resumeStep;
    setResumeStep(null);
    if (store && menu) void confirmMenu(target);
  }, [resumeStep, user, step, store, menu]);

  const pickNewPhoto = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const selected = await choosePhoto.mutateAsync();
      if (selected) { setPhoto(selected); setPhotoReselect(false); }
    } catch (error) { showPhotoFailure(error, 'store_pick_photo_choose'); }
    finally { busy.current = false; }
  };

  const save = async (expectedOverride?: string | null) => {
    if (!user || !store || !menu || busy.current || saving) return;
    if (!reviewValid) { setShowReviewError(true); return; }
    if (!menu.categoryId) { setSaveError(new AppError('CATEGORY_NOT_PICKABLE')); return; }
    if (needsPhoto && !photo) { setSaveError(new AppError('PHOTO_REQUIRED')); setStep(4); return; }
    const expected = expectedOverride !== undefined ? expectedOverride : expectedPreviousPickId;
    if (expected === undefined) { setSaveError(new AppError('INTERNAL_ERROR')); return; }

    busy.current = true;
    setSaveError(null);
    const requestId = requestIdRef.current ?? Crypto.randomUUID();
    requestIdRef.current = requestId;

    try {
      const result = await registration.mutateAsync({
        userId: user.id,
        categoryId: menu.categoryId,
        channel: storeChannel,
        oneLineReview: trimmedReview,
        requestId,
        expectedPreviousPickId: expected,
        itemId: itemId ?? undefined,
        catalogId: pickScope !== 'brand' && store.kind === 'place' && !itemId ? store.catalogId : undefined,
        providerId: store.kind === 'seller' && !itemId ? store.providerId : undefined,
        brandId: pickScope === 'brand' && !itemId ? preflight?.brand?.brandId : undefined,
        newPlace: store.kind === 'new' ? {
          name: store.name,
          mapUrl: store.mapUrl,
        } : undefined,
        photo: needsPhoto ? photo : undefined,
      });

      drafts.clear();
      setDone({ pickId: result.pickId, itemId: result.itemId });
      setPickChangedElsewhere(false);
      setStep(6);
      // Approved in #552: no confirmation dialog; the item detail shows a toast.
      armPickSavedToast(result.pickId);
      router.replace({ pathname: '/item/[itemId]', params: { itemId: result.itemId, pickId: result.pickId } });
    } catch (error) {
      if (error instanceof AppError && error.code === 'PICK_CHANGED_ELSEWHERE') {
        setPickChangedElsewhere(true);
        setSaveError(null);
      } else {
        if (photo && isPhotoFailure(error)) showPhotoFailure(error, 'store_pick_photo_upload');
        setSaveError(error);
      }
    } finally { busy.current = false; }
  };

  const confirmChangedPickAndSave = async () => {
    if (!user || !store || !menu?.categoryId || busy.current || saving) return;
    busy.current = true;
    setSaveError(null);
    let latestExpected: string | null;
    try {
      const current = await currentPickSlot.mutateAsync({
        userId: user.id,
        categoryId: menu.categoryId,
        channel: storeChannel,
      });
      latestExpected = current?.id ?? null;
      setExpectedPreviousPickId(latestExpected);
    } catch (error) {
      setSaveError(error);
      return;
    } finally {
      busy.current = false;
    }
    setPickChangedElsewhere(false);
    await save(latestExpected);
  };

  const aiAllowed = new Set(availableMenus.map((option) => option.categoryId));
  const aiSuggestions = (suggestions.data?.suggestions ?? [])
    .filter((entry) => aiAllowed.size === 0 || aiAllowed.has(entry.categoryId))
    .filter((entry) => entry.confidence !== 'low');
  const aiTried = Boolean(requestedMenu && aiMenuName === requestedMenu);
  const autoSuggestedMenu = aiTried && !manualCategory && !suggestions.isFetching
    && exactMenuMatches.length === 0 && aiSuggestions.length > 0
    ? { categoryId: aiSuggestions[0].categoryId, name: requestedMenu || aiSuggestions[0].label }
    : null;
  const effectiveMenu = menu ?? autoSuggestedMenu;
  const showManualCategory = Boolean(requestedMenu && exactMenuMatches.length === 0
    && (manualCategory || (aiTried && !suggestions.isFetching && aiSuggestions.length === 0)));
  const normalizedCategoryQuery = compactMenuName(categoryQuery);
  const manualMatches = (normalizedCategoryQuery
    ? availableMenus.filter((option) => {
        const label = compactMenuName([option.groupName, option.name].filter(Boolean).join(' '));
        return label.includes(normalizedCategoryQuery);
      })
    : availableMenus).slice(0, 20);
  const chooseMenu = (option: Pick<MenuOption, 'categoryId' | 'name'>) => {
    if (menu?.categoryId !== option.categoryId) {
      setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null);
      setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
    }
    setMenu({ categoryId: option.categoryId, name: requestedMenu || option.name });
  };

  const cancel = () => {
    if (saving || busy.current || done) return;
    drafts.clear();
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
            <Text style={styles.stepMeta}>1 / 4 · {requesting && requestPart === 'link' ? newStoreName : '오프라인 매장'}</Text>
            <Text style={styles.title}>
              {!requesting ? '상호명을 검색해 주세요' : requestPart === 'name' ? '매장 이름을 알려 주세요' : '네이버 지도 링크를 붙여넣어 주세요'}
            </Text>
            {!requesting ? <>
              <View style={styles.fieldBlock}>
                <FieldLabel label="상호명" />
                <TextInput accessibilityLabel="매장명 검색" autoFocus autoCapitalize="none" maxLength={100}
                  onChangeText={setQuery} value={query} returnKeyType="search" style={styles.input} placeholderTextColor={OnePick.textTertiary}
                  placeholder="상호명을 입력해 주세요" />
                {search.valid && !search.isWaiting && !search.isFetching && !search.isError && (search.data ?? []).length > 0
                  ? <Text style={styles.helper}>검색 결과 {(search.data ?? []).length}개 · 지점과 주소를 확인해 주세요.</Text>
                  : <Text style={styles.helper}>{PLACE_COVERAGE_NOTICE}</Text>}
              </View>
              {search.valid && (search.isWaiting || search.isFetching) ? <View style={styles.loading}><ActivityIndicator color={OnePick.textPrimary} /></View> : null}
              {search.isError ? <StateCard compact tone="danger" title="검색하지 못했어요" action={{ label: '다시 검색', onPress: () => { void search.refetch(); } }} /> : null}
              <View style={styles.results}>
                {(search.data ?? []).filter((candidate) => candidate.kind === 'place').map((candidate) => <Pressable key={candidate.catalogId}
                  accessibilityRole="button" accessibilityLabel={`${candidate.name} 선택`} onPress={() => pickStore(candidate)}
                  style={({ pressed }) => [styles.resultCard, pressed && styles.flowPressed]}>
                  <Text style={styles.resultTitle}>{candidate.name}{candidate.branchName ? ` · ${candidate.branchName}` : ''}</Text>
                  <Text style={styles.resultMeta} numberOfLines={1}>
                    {[candidate.region, candidate.address ? '상세 주소 표시 ›' : candidate.providerCategory].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>)}
              </View>
              {search.valid && !search.isWaiting && !search.isFetching && !search.isError && (search.data ?? []).length === 0
                ? <Text style={styles.helper}>검색한 이름의 매장을 찾지 못했어요.</Text> : null}
            </> : requestPart === 'name' ? <View style={styles.fieldBlock}>
              {/* One input per screen (#593): the store name here, its Naver map link next. */}
              <FieldLabel label="상호명" />
              <TextInput accessibilityLabel="등록 요청 이름" maxLength={100} value={newName} onChangeText={setNewName} style={styles.input}
                placeholder="매장 이름 (지점명 포함)" placeholderTextColor={OnePick.textTertiary} />
              <Text style={styles.helper}>검색한 이름을 넣어 두었어요. 지점이 있으면 지점명까지 적어 주세요.</Text>
            </View> : <View style={styles.fieldBlock}>
              <FieldLabel label="네이버 지도 링크" />
              <TextInput accessibilityLabel="네이버 지도 링크" autoCapitalize="none" keyboardType="url" maxLength={2048}
                value={mapLink} onChangeText={setMapLink} style={styles.input}
                placeholder="https://naver.me/…" placeholderTextColor={OnePick.textTertiary} />
              {mapLink.trim() && !validMapLink
                ? <Text accessibilityRole="alert" style={styles.error}>네이버 지도 링크를 확인해주세요.</Text>
                : <Text style={styles.helper}>네이버 지도에서 매장을 열고 공유 → 링크 복사를 눌러 주세요.{'\n'}링크를 붙여넣으면 다음으로 넘어갈 수 있어요.</Text>}
            </View>}
          </View>
          <View style={styles.footer}>
            {!requesting
              ? <FlowButton variant="secondary" label="찾는 매장이 없어요"
                  onPress={() => { setRequesting(true); setRequestPart('name'); setNewName(query); setMapLink(''); }} />
              : requestPart === 'name'
                ? <FlowButton label="다음" disabled={!validNewName} onPress={() => setRequestPart('link')} />
                : <FlowButton label="다음" disabled={!canRequest}
                    onPress={() => pickStore({ kind: 'new', name: newStoreName, channel: 'offline', mapUrl: mapLink.trim() })} />}
          </View>
        </> : null}

        {step === 2 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>2 / 4 · {storeDisplayName}</Text>
            <Text style={styles.title}>어떤 메뉴인가요?</Text>
            <View style={styles.fieldBlock}>
              <FieldLabel label="메뉴명" />
              <TextInput accessibilityLabel="메뉴 이름" maxLength={40} value={menuQuery}
                onChangeText={(value) => {
                  setMenuQuery(value); setMenu(null); setAiMenuName(''); setManualCategory(false); setCategoryQuery('');
                  setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null);
                  setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
                }}
                onSubmitEditing={() => { if (menus.isSuccess && requestedMenu && exactMenuMatches.length === 0) setAiMenuName(requestedMenu); }}
                returnKeyType="search" style={styles.input} placeholder="예: 미역국" placeholderTextColor={OnePick.textTertiary} />
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

            {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiTried && suggestions.isFetching ? <View style={styles.fieldBlock}>
              <FieldLabel label="카테고리" required={false} />
              <View style={styles.loadingRow}><ActivityIndicator color={OnePick.textPrimary} /><Text style={styles.helperInline}>메뉴명으로 카테고리를 찾고 있어요</Text></View>
            </View> : null}

            {menus.isSuccess && requestedMenu && exactMenuMatches.length === 0 && aiTried && !suggestions.isFetching && aiSuggestions.length > 0 && !showManualCategory
              ? <View style={styles.fieldBlock}>
                <FieldLabel label="카테고리 · AI 추천" required={false} />
                <View style={styles.chips}>
                  {aiSuggestions.map((entry) => <FlowChip key={entry.categoryId} label={entry.label}
                    accessibilityLabel={`AI 추천 ${entry.label}`} selected={effectiveMenu?.categoryId === entry.categoryId}
                    onPress={() => chooseMenu({ categoryId: entry.categoryId, name: entry.label })} />)}
                </View>
                {aiSuggestions.find((entry) => entry.categoryId === effectiveMenu?.categoryId)
                  ? <Text style={styles.helper}>{aiSuggestions.find((entry) => entry.categoryId === effectiveMenu?.categoryId)?.reason}</Text> : null}
                <FlowButton variant="text" label="다른 카테고리 찾기" onPress={() => { setManualCategory(true); setMenu(null); }} />
              </View> : null}

            {showManualCategory ? <View style={styles.fieldBlock}>
              <FieldLabel label="카테고리" />
              <Text style={styles.helper}>카테고리를 추천하지 못했어요. 가까운 것을 직접 골라 주세요.</Text>
              <TextInput accessibilityLabel="카테고리 검색" value={categoryQuery} onChangeText={setCategoryQuery}
                style={styles.input} placeholder="카테고리 검색 (예: 국수)" placeholderTextColor={OnePick.textTertiary} />
              <View style={styles.chips}>
                {manualMatches.map((option) => <FlowChip key={option.categoryId}
                  label={[option.groupName, option.name].filter(Boolean).join(' › ')}
                  selected={menu?.categoryId === option.categoryId} onPress={() => chooseMenu(option)} />)}
              </View>
              <Text style={styles.helper}>원픽을 바로 저장하려면 현재 등록 가능한 카테고리 중 하나를 골라주세요.</Text>
            </View> : null}

            {requestedMenu && exactMenuMatches.length === 0 && !aiTried ? <View style={styles.loadingRow}>
              <ActivityIndicator color={OnePick.textPrimary} /><Text style={styles.helperInline}>입력이 끝나면 카테고리를 추천해 드려요</Text>
            </View> : null}
            {preflight?.brand ? <View style={styles.fieldBlock}>
              <FieldLabel label="원픽 범위" />
              <Text style={styles.helper}>지점을 고르면 이 매장만, 브랜드 전체를 고르면 모든 지점과 별개의 원픽이 됩니다.</Text>
              <View style={styles.chips}>
                <FlowChip label="이 지점" selected={pickScope === 'branch'} onPress={() => {
                  setPickScope('branch'); setItemId(null); setItemHadPhoto(false); setItemPending(false);
                  setPhoto(null); setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
                }} />
                <FlowChip label={`${preflight.brand.name} 전체`} selected={pickScope === 'brand'} onPress={() => {
                  setPickScope('brand'); setItemId(null); setItemHadPhoto(false); setItemPending(false);
                  setPhoto(null); setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
                }} />
              </View>
            </View> : null}
            {selectItem.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(selectItem.error)}</Text> : null}
            {currentPickSlot.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(currentPickSlot.error)}</Text> : null}
          </View>
          <View style={styles.footer}>
            <FlowButton label={preflight?.brand && !pickScope ? '범위 선택하기' : '다음'}
              disabled={!effectiveMenu || suggestions.isFetching || Boolean(preflight?.brand && !pickScope)}
              loading={selectItem.isPending} onPress={() => void confirmMenu()} />
          </View>
        </> : null}

        {step === 4 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>3 / 4 · {pickDisplayName} · {menu?.name ?? '사진'}</Text>
            <Text style={styles.title}>대표 사진을 올려주세요</Text>
            <Text style={styles.helper}>사진이 없는 원픽은 대표 사진이 필요해요. 저장 전까지는 선택한 사진만 유지됩니다.</Text>
            {needsPhoto ? <View style={styles.photoPanel}>
              {photoReselect && !photo
                ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.noticeText}>사진을 다시 선택해주세요</Text></View> : null}
              {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" /> : null}
              <FlowButton variant="secondary" label={photo ? '사진 바꾸기' : '사진 선택'} loading={choosePhoto.isPending} onPress={() => void pickNewPhoto()} />
              {photo ? <FlowButton variant="text" label="사진 빼기" onPress={() => setPhoto(null)} /> : null}
            </View> : <StateCard compact title="사진이 등록됐어요" />}
          </View>
          <View style={styles.footer}>
            <FlowButton label="다음" disabled={needsPhoto && !photo} onPress={() => setStep(5)} />
          </View>
        </> : null}

        {(step === 5 || step === 6) && store && menu ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>4 / 4 · {pickDisplayName} · {menu.name}</Text>
            <Text style={styles.title}>한줄평을 남겨주세요</Text>
            {pickChangedElsewhere
              ? <View style={styles.notice}><Text style={styles.noticeText}>다른 기기에서 이 메뉴의 원픽이 바뀌었어요. 다시 등록하면 방금 확인한 최신 원픽을 기준으로 교체합니다.</Text></View>
              : !itemPending && replacingVisiblePick
                ? <View style={styles.notice}><Text style={styles.noticeText}>저장하면 이 메뉴의 매장 원픽이 이걸로 바뀝니다.</Text></View> : null}
            <View style={styles.fieldBlock}>
              <FieldLabel label="한줄평" />
              <TextInput accessibilityLabel="원픽 한줄평" multiline maxLength={100} editable={!saving && step !== 6} value={review}
                onChangeText={(value) => { setReview(value); setShowReviewError(false); }} style={[styles.input, styles.reviewInput]}
                placeholder="예: 국물이 진한데 부담스럽지 않아요." placeholderTextColor={OnePick.textTertiary} />
            </View>
            <Text style={styles.counter}>{review.length} / 100자</Text>
            {showReviewError && !reviewValid ? <Text accessibilityRole="alert" style={styles.error}>한줄평을 1~100자로 입력해주세요.</Text> : null}
            {saveError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(saveError)}</Text> : null}
          </View>
          <View style={styles.footer}>
            <FlowButton label={pickChangedElsewhere ? '변경 확인 후 등록하기' : '원픽 등록하기'} loading={saving || currentPickSlot.isPending} disabled={step === 6}
              onPress={() => void (pickChangedElsewhere ? confirmChangedPickAndSave() : save())} />
          </View>
        </> : null}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: OnePick.bgDefault },
  stateArea: { padding: OnePickSpace.lg },
  content: { flexGrow: 1, width: '100%', maxWidth: 390, alignSelf: 'center' },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: OnePickSpace.gutter,
    backgroundColor: OnePick.bgDefault,
  },
  headerSide: { width: 48, height: 56, justifyContent: 'center', alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end' },
  backText: { ...OnePickType.headline, color: OnePick.textPrimary },
  headerTitle: { ...OnePickType.headline, flex: 1, color: OnePick.textPrimary, textAlign: 'center' },
  headerAction: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  body: { flexGrow: 1, gap: OnePickSpace.md, paddingTop: OnePickSpace.md, paddingHorizontal: OnePickSpace.gutter },
  footer: {
    gap: OnePickSpace.sm,
    marginTop: 'auto',
    paddingTop: OnePickSpace.lg,
    paddingHorizontal: OnePickSpace.gutter,
    paddingBottom: OnePickSpace.xxl,
  },
  stepMeta: { ...OnePickType.caption, color: OnePick.textSecondary },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  channelChoice: { gap: OnePickSpace.sm, marginTop: OnePickSpace.xs },
  fieldBlock: { gap: OnePickSpace.sm },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: OnePickSpace.xs },
  fieldLabel: { ...OnePickType.bodyMedium, color: OnePick.textSecondary },
  fieldRequired: { ...OnePickType.bodyMedium, color: OnePick.textAccent },
  input: {
    height: 52,
    borderWidth: 0,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgSubtle,
    paddingHorizontal: OnePickSpace.lg,
    paddingVertical: OnePickSpace.md,
    color: OnePick.textPrimary,
    ...OnePickType.body,
  },
  reviewInput: { height: 120, padding: OnePickSpace.lg, textAlignVertical: 'top' },
  helper: { ...OnePickType.caption, color: OnePick.textSecondary },
  helperInline: { ...OnePickType.caption, color: OnePick.textSecondary },
  error: { ...OnePickType.caption, color: OnePick.textDanger },
  loading: { paddingVertical: OnePickSpace.lg, alignItems: 'center' },
  loadingRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  results: { gap: OnePickSpace.sm },
  resultCard: {
    minHeight: 60,
    justifyContent: 'center',
    gap: OnePickSpace.xs,
    paddingHorizontal: OnePickSpace.lg,
    paddingVertical: OnePickSpace.sm,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgSubtle,
  },
  resultTitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  resultMeta: { ...OnePickType.caption, color: OnePick.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: OnePickSpace.sm },
  flowChip: {
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: OnePickSpace.md,
    borderRadius: OnePickRadius.full,
    backgroundColor: OnePick.bgMuted,
  },
  flowChipSelected: { backgroundColor: OnePick.actionPrimary },
  flowChipLabel: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  flowChipLabelSelected: { color: OnePick.onAction },
  flowButton: {
    alignSelf: 'stretch',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: OnePickSpace.xl,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.actionPrimary,
  },
  flowButtonSecondary: {
    backgroundColor: OnePick.bgDefault,
    borderWidth: 1,
    borderColor: OnePick.borderStrong,
  },
  flowButtonText: { minHeight: 40, paddingHorizontal: 0, backgroundColor: 'transparent' },
  flowButtonDisabled: { backgroundColor: OnePick.actionDisabled, borderWidth: 0 },
  flowButtonLabel: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  flowButtonLabelDark: { color: OnePick.textPrimary },
  flowPressed: { opacity: 0.88 },
  photoPanel: { gap: OnePickSpace.md },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgSubtle,
  },
  notice: { padding: OnePickSpace.md, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgAccentSubtle },
  noticeText: { ...OnePickType.caption, color: OnePick.textPrimary },
  counter: { ...OnePickType.caption, alignSelf: 'stretch', color: OnePick.textTertiary, textAlign: 'right' },
});
