import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, StateCard } from '@/components/ui';
import { DIALOG_CANCEL_LABEL } from '@/components/ui/dialog-labels';
import { OnePick, OnePickLayout, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useLinkCategorySuggestions } from '@/hooks/useLinkCategorySuggestions';
import { useChoosePhoto, useReadCurrentPickSlot, useRegisterItemPick } from '@/hooks/useRegisterPick';
import { useMenuOptions, useMenuSuggestions, useProviderStorePrefill, useSelectStoreItem, useStoreSearch } from '@/hooks/useStoreFirst';
import { PLACE_COVERAGE_NOTICE, type PickChannel } from '@/lib/items/pickChannel';
import { armPickSavedToast } from '@/lib/items/pickSavedToast';
import { isPhotoFailure, showPhotoFailure } from '@/lib/photos/photoFailure';
import { pickDraftStore, type PickDraftStep, type RestoredPickDraft } from '@/lib/pick/pickDraft';
import { registrationFooterPadding } from '@/lib/pick/registrationFooterLayout';
import { useSwipeBackHandler } from '@/lib/navigation/swipeBack';
import { extractNaverMapUrl, isNaverMapUrl, type StoreCandidate, type StoreSelection } from '@/services/storeFirstService';
import type { LinkPlaceMatch } from '@/types/domain/linkCategorySuggestion';
import type { PickPhotoDraft } from '@/types/domain/photo';

// 원픽 등록 4단계: 네이버 지도 링크/매장 → 메뉴 → 사진 → 한줄평. 기본 진입은 링크이며 URL 없음만 매장 검색으로 전환한다.
// Everything the user enters lives in this one screen's state, so moving back
// and forth between steps never loses a typed review or a chosen photo. The same
// state is mirrored to an account-bound draft (lib/pick/pickDraft) so a login round
// trip in this writing session returns to it (#475); server state is re-checked.

type Step = 1 | 2 | 4 | 5 | 6;
type NewStore = { kind: 'new'; name: string; channel: 'offline'; mapUrl: string };
type Store = StoreCandidate | NewStore;
type Done = { pickId: string; itemId: string };
type EntryParams = {
  providerId?: string | string[];
  categoryId?: string | string[];
  menuName?: string | string[];
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;
const entryId = (value: string | string[] | undefined) => {
  const candidate = scalar(value);
  return candidate && UUID.test(candidate) ? candidate : undefined;
};
// Naver titles read "스타벅스 강남우성점"; the catalog keeps name 스타벅스 + branch 강남우성.
const placeKey = (value: string) => value.replace(/\s+/g, '').toLocaleLowerCase('ko-KR').replace(/점$/, '');
const linkCandidate = (place: LinkPlaceMatch): Extract<StoreCandidate, { kind: 'place' }> => ({
  kind: 'place',
  catalogId: place.catalogId,
  name: place.name,
  branchName: place.branchName,
  region: [place.region1, place.region2].filter(Boolean).join(' ') || null,
  address: place.roadAddress ?? place.address,
  providerCategory: place.providerCategory,
  mapUrl: null,
});
const entryMenu = (value: string | string[] | undefined) => {
  const candidate = scalar(value)?.trim().replace(/\s+/g, ' ') ?? '';
  return candidate.length >= 1 && candidate.length <= 40 ? candidate : undefined;
};

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
  const { bottom: deviceBottomInset } = useSafeAreaInsets();
  // SafeAreaView already reserves the device inset. Add only the remainder needed
  // for the Figma 34px bottom clearance, avoiding double padding on iPhone.
  const footerBottomPadding = registrationFooterPadding(OnePickLayout.safeAreaBottom, deviceBottomInset);
  const params = useLocalSearchParams<EntryParams>();
  const entryProviderId = entryId(params.providerId);
  const entryCategoryId = entryId(params.categoryId);
  const entryMenuName = entryMenu(params.menuName);
  const auth = useAuthSession();
  const user = auth.user;
  const [step, setStep] = useState<Step>(1);
  const [query, setQuery] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestPart, setRequestPart] = useState<'name' | 'link'>('name');
  const [newName, setNewName] = useState('');
  // Step 1 starts from a Naver map link. A validated provider-context entry keeps
  // the store the person was already viewing instead of asking for its link again.
  const [linkEntry, setLinkEntry] = useState(!entryProviderId);
  const [entryLink, setEntryLink] = useState('');
  // The link could not give a name: only the name is asked, the pasted link is kept.
  const [nameOnlyFromLink, setNameOnlyFromLink] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [menuQuery, setMenuQuery] = useState('');
  const [aiMenuName, setAiMenuName] = useState('');
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
  const linkRequestRef = useRef(0);
  const linkOwnerRef = useRef(user?.id);
  if (linkOwnerRef.current !== user?.id) {
    linkOwnerRef.current = user?.id;
    linkRequestRef.current += 1;
  }
  useEffect(() => () => { linkRequestRef.current += 1; }, []);
  // Account whose draft this screen has loaded; null until the session resolves.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  // Saved step 3/4 to return to after the menu selection is re-checked on the server.
  const [resumeStep, setResumeStep] = useState<PickDraftStep | null>(null);
  // A photo was chosen before the round trip but could not be kept.
  const [photoReselect, setPhotoReselect] = useState(false);
  const [prefillDismissed, setPrefillDismissed] = useState(false);
  const [menuPrefilled, setMenuPrefilled] = useState(false);
  const restoredDraftRef = useRef(false);
  const entryMenuPrefillConsumedRef = useRef(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const drafts = pickDraftStore();

  const resetForm = () => {
    linkRequestRef.current += 1;
    setConfirmReplacement(false);
    setStep(1); setQuery(''); setRequesting(false); setRequestPart('name'); setNewName(''); setStore(null);
    setLinkEntry(!entryProviderId); setEntryLink(''); setNameOnlyFromLink(false);
    setMenuQuery(''); setAiMenuName(''); setMenu(null);
    setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null);
    setMapLink(''); setPhoto(null); setReview(''); setShowReviewError(false); setDone(null); setSaveError(null);
    setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
    setResumeStep(null); setPhotoReselect(false); setPrefillDismissed(false); setMenuPrefilled(false);
    restoredDraftRef.current = false;
    entryMenuPrefillConsumedRef.current = false;
  };
  const applyDraft = (draft: RestoredPickDraft) => {
    restoredDraftRef.current = true;
    entryMenuPrefillConsumedRef.current = true;
    setPrefillDismissed(true);
    setMenuPrefilled(false);
    setQuery(draft.query); setRequesting(draft.requesting); setRequestPart(draft.requestPart ?? 'name'); setNewName(draft.newName);
    // A saved name-search path must remain the previous in-flow screen when a
    // restored menu/photo/review step goes back to 1/4.
    setLinkEntry(!(draft.query || draft.requesting));
    setMapLink(draft.mapLink); setStore(draft.store as Store | null); setMenuQuery(draft.menuQuery);
    // Legacy drafts may contain a user-selected category. Reclassify the menu.
    setMenu(null);
    setPickScope(draft.pickScope); setReview(draft.review); setPhoto(draft.photo); setPhotoReselect(draft.photoLost);
    // Item, photo requirement and the current Pick slot come from the server again:
    // later steps resume only after the menu step's own checks pass (never auto-submit).
    // A prior restore may have saved menu:null while awaiting classification.
    // Keep the target using the typed name, not an untrusted saved category.
    if (draft.step >= 4 && draft.store && (draft.menu || draft.menuQuery.trim())) { setStep(2); setResumeStep(draft.step); }
    else setStep(draft.step >= 4 ? (draft.store ? 2 : 1) : draft.step);
  };
  // Load once per resolved account. Nothing is read while the session is still being
  // checked, and a different account first gets an empty form (its predecessor's
  // in-memory input is dropped and the stored draft is discarded by load()).
  if (!auth.isLoading && user && hydratedFor !== user.id) {
    if (hydratedFor !== null) resetForm();
    setHydratedFor(user.id);
    const draft = drafts.load(user.id);
    restoredDraftRef.current = Boolean(draft);
    if (draft) applyDraft(draft);
  }

  const providerPrefill = useProviderStorePrefill(
    entryProviderId,
    Boolean(user) && hydratedFor === user?.id && !restoredDraftRef.current && !prefillDismissed && step === 1 && !linkEntry && !requesting,
  );
  const providerPrefillStore = !query && !store && !prefillDismissed ? providerPrefill.data ?? null : null;
  const providerPrefillDisplayName = providerPrefillStore
    ? [providerPrefillStore.name, providerPrefillStore.branchName].filter(Boolean).join(' ')
    : '';
  const storeSearchValue = providerPrefillStore ? providerPrefillDisplayName : query;

  const storeDisplayName = store ? (store.kind === 'place' && store.branchName ? `${store.name} · ${store.branchName}` : store.name) : '';
  const pickDisplayName = pickScope === 'brand' && preflight?.brand ? `${preflight.brand.name} 전체` : storeDisplayName;
  const storeChannel: PickChannel = store?.kind === 'seller' ? 'online' : 'offline';
  const search = useStoreSearch(
    'offline',
    query,
    Boolean(user) && step === 1 && !linkEntry && !requesting && !providerPrefillStore && !providerPrefill.isLoading,
  );
  const storeSearchReady = search.valid && !search.isWaiting;
  const fetchNextStores = () => {
    if (!storeSearchReady || !search.hasNextPage || search.isFetching) return;
    void search.fetchNextPage({ cancelRefetch: false });
  };
  const menus = useMenuOptions(Boolean(user) && step === 2);
  const linkLookup = useLinkCategorySuggestions();
  const validEntryLink = isNaverMapUrl(entryLink);
  const linkResult = linkLookup.data?.kind === 'place' ? linkLookup.data : null;
  const linkName = linkResult?.resolvedName?.trim().replace(/\s+/g, ' ').slice(0, 100) ?? '';
  const linkMatches = (linkResult?.places ?? []).map(linkCandidate);
  const linkExact = linkName
    ? linkMatches.filter((candidate) => placeKey(candidate.name + (candidate.branchName ?? '')) === placeKey(linkName)
        || placeKey(candidate.name) === placeKey(linkName))
    : [];
  // A store is chosen for the person only when exactly one catalog row has the link's name.
  const linkSelected = linkExact.length === 1 ? linkExact[0] : null;
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
  const prefilledCategoryOption = menuPrefilled && entryCategoryId
    ? availableMenus.find((option) => option.categoryId === entryCategoryId)
    : undefined;
  const prefilledMenu = requestedMenu && prefilledCategoryOption
    ? { categoryId: prefilledCategoryOption.categoryId, name: requestedMenu }
    : null;
  const suggestions = useMenuSuggestions(
    suggestionStore,
    storeKey,
    aiMenuName,
    Boolean(user) && step === 2 && menus.isSuccess && Boolean(aiMenuName) && aiMenuName === requestedMenu
      && exactMenuMatches.length !== 1 && !prefilledMenu,
  );
  useEffect(() => {
    if (step !== 2 || !menus.isSuccess || !requestedMenu || exactMenuMatches.length === 1 || prefilledMenu) {
      if (!requestedMenu || exactMenuMatches.length === 1) setAiMenuName('');
      return;
    }
    const timeout = setTimeout(() => setAiMenuName(requestedMenu), 450);
    return () => clearTimeout(timeout);
  }, [step, menus.isSuccess, requestedMenu, exactMenuMatches.length, prefilledMenu?.categoryId]);

  const aiAllowed = new Set(availableMenus.map((option) => option.categoryId));
  const aiSuggestions = (suggestions.data?.suggestions ?? [])
    .filter((entry) => aiAllowed.has(entry.categoryId) && entry.confidence === 'high');
  const aiTried = Boolean(requestedMenu && aiMenuName === requestedMenu);
  const highConfidenceIds = new Set(aiSuggestions.map((entry) => entry.categoryId));
  const autoSuggestedMenu = aiTried && !suggestions.isFetching && !suggestions.isError
    && !suggestions.data?.needsNewCategory && highConfidenceIds.size === 1
    ? { categoryId: aiSuggestions[0].categoryId, name: requestedMenu }
    : null;
  const exactMenu = exactMenuMatches.length === 1
    ? { categoryId: exactMenuMatches[0].categoryId, name: requestedMenu }
    : null;
  // Step 2 always derives its category from current inputs/server data, including
  // restored legacy drafts. The committed menu is used only in later steps.
  const classifiedMenu = menus.isSuccess ? prefilledMenu ?? exactMenu ?? autoSuggestedMenu : null;
  // An unknown dish is still a valid registration. Preserve its name and let
  // the server save a separate unclassified Pick instead of inventing a category.
  const effectiveMenu = classifiedMenu ?? (requestedMenu && requestedMenu.length <= 40 && storeChannel === 'offline'
    ? { categoryId: null, name: requestedMenu } : null);
  const classificationPending = Boolean(requestedMenu && !effectiveMenu && !menus.isError
    && (!menus.isSuccess || !aiTried || suggestions.isFetching));
  const classificationUnresolved = Boolean(requestedMenu && menus.isSuccess && !effectiveMenu
    && aiTried && !suggestions.isFetching);
  // Classification has settled once the menu list (and any AI pass for the typed
  // name) has answered. Until then the unclassified fallback above is only a
  // placeholder for the person's own "다음" tap, never a decision a draft restore
  // may make on its own (#836 H1).
  const classificationSettled = menus.isError
    || (menus.isSuccess && (Boolean(classifiedMenu) || (aiTried && !suggestions.isFetching)));

  const draftOwner = user && hydratedFor === user.id ? user.id : null;
  useEffect(() => {
    if (!draftOwner || done) return;
    drafts.save(draftOwner, {
      step: resumeStep ?? (step === 6 ? 5 : step), query, requesting, requestPart, newName, mapLink, store,
      menuQuery, manualCategory: false, categoryQuery: '', menu, pickScope, review,
    });
  }, [draftOwner, done, resumeStep, step, query, requesting, requestPart, newName, mapLink, store, menuQuery,
    menu, pickScope, review]);
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
  // A provider-profile entry already has a real previous screen. Its step-1 prefill
  // is the root of this registration flow, not the name-search fallback.
  const providerContextRoot = step === 1 && Boolean(entryProviderId) && !prefillDismissed && !restoredDraftRef.current;

  const previousFrom = (from: Step): Step => {
    if (from === 2) return 1;
    if (from === 4) return 2;
    if (from === 5) return 4;
    return 5;
  };
  const goBack = () => {
    if (saving || busy.current) return;
    linkRequestRef.current += 1;
    setConfirmReplacement(false);
    setResumeStep(null);
    if (step === 6) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    if (step === 1 && requesting && nameOnlyFromLink) { setRequesting(false); setNameOnlyFromLink(false); setLinkEntry(true); return; }
    if (step === 1 && requesting && requestPart === 'link') { setRequestPart('name'); return; }
    if (step === 1 && requesting) { setRequesting(false); setLinkEntry(false); return; }
    if (step === 1 && !linkEntry && providerContextRoot) {
      if (router.canGoBack()) router.back(); else router.replace('/');
      return;
    }
    if (step === 1 && !linkEntry) { setLinkEntry(true); return; }
    if (step === 1) { if (router.canGoBack()) router.back(); else router.replace('/'); return; }
    setStep(previousFrom(step));
  };
  // Web edge swipe = this header's "이전 단계": step back inside the flow; leaving
  // from step 1 keeps the account-bound draft, so no unsaved-input prompt.
  const hasInternalBackTarget = step === 1 ? ((!linkEntry && !providerContextRoot) || requesting) : step !== 6;
  useSwipeBackHandler(goBack, { confirmUnsaved: false, hasInternalBackTarget });
  const applyEntryMenuPrefill = () => {
    if (!entryMenuName || restoredDraftRef.current || entryMenuPrefillConsumedRef.current) return;
    entryMenuPrefillConsumedRef.current = true;
    setMenuQuery(entryMenuName);
    setMenu(null);
    setMenuPrefilled(true);
    setAiMenuName('');
  };
  const pickStore = (candidate: Store) => {
    if (store && storeKey !== (candidate.kind === 'place' ? `place:${candidate.catalogId}` : candidate.kind === 'seller' ? `seller:${candidate.providerId}` : `new:offline:${candidate.name}`)) {
      setMenu(null); setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null); setPhoto(null);
      setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
    }
    setStore(candidate);
    setAiMenuName('');
    applyEntryMenuPrefill();
    setStep(2);
  };
  const findByLink = () => {
    if (!validEntryLink || linkLookup.isPending) return;
    const url = entryLink.trim();
    const request = ++linkRequestRef.current;
    linkLookup.mutate({ url }, { onSuccess: (result) => {
      if (request !== linkRequestRef.current || result.kind !== 'place') return;
      const name = result.resolvedName?.trim().replace(/\s+/g, ' ') ?? '';
      // Missing from the catalog is a new store, not a registration dead end.
      // Prepare it once for this lookup; the existing final save writes newPlace.
      // Keep candidate confirmation when a catalog match might already exist.
      if (name && name.length <= 100 && !result.needsName && result.places.length === 0) {
        pickStore({ kind: 'new', name, channel: 'offline', mapUrl: url });
      }
    } });
  };
  // No catalog match: register the store under the name read from the link, with the link itself.
  const registerFromLink = () => {
    const url = entryLink.trim();
    if (linkName) { pickStore({ kind: 'new', name: linkName, channel: 'offline', mapUrl: url }); return; }
    setLinkEntry(false); setRequesting(true); setRequestPart('name'); setNewName(''); setMapLink(url); setNameOnlyFromLink(true);
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
    // Consume the target only after success, not on failed lookups or
    // while waiting for an explicit brand-scope choice.
    setMenu(effectiveMenu);
    if (!effectiveMenu.categoryId) {
      setResumeStep(null);
      setExpectedPreviousPickId(null);
      setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null);
      setPickScope('branch'); setStep(photoStep(4));
      return;
    }

    busy.current = true;
    try {
      if (store.kind === 'new') {
        await readCurrentSlotSnapshot(effectiveMenu.categoryId);
        setResumeStep(null);
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
      setResumeStep(null);
      setStep(target.hasPhoto ? 5 : photoStep(4));
    } catch { /* Each mutation exposes its own error under the menu controls. */ }
    finally { busy.current = false; }
  };

  // A restored later step resumes on its own only for a menu the catalog/AI
  // classified. While the menu list or the AI pass is still loading nothing is
  // decided; when they settle without a match the person stays on this step and
  // confirms the unclassified registration with their own tap (photo and review
  // restored so far are kept and used by that tap).
  useEffect(() => {
    if (resumeStep === null || !user || step !== 2 || !classificationSettled || !classifiedMenu) return;
    const target = resumeStep;
    if (store) void confirmMenu(target);
  }, [resumeStep, user, step, store, classificationSettled, classifiedMenu?.categoryId]);

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
        ...(!menu.categoryId ? { menuName: menu.name } : {}),
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

  const cancel = () => {
    if (saving || busy.current || done) return;
    linkRequestRef.current += 1;
    drafts.clear();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const header = <View style={styles.header}>
    <Pressable accessibilityRole="button" accessibilityLabel="이전 단계" onPress={goBack} style={styles.headerSide}>
      <Icon name="back" />
    </Pressable>
    <Text style={styles.headerTitle}>새 원픽 등록</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="원픽 등록 취소" onPress={cancel} style={[styles.headerSide, styles.headerRight]}>
      <Text style={styles.headerAction}>{DIALOG_CANCEL_LABEL}</Text>
    </Pressable>
  </View>;

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safe}><View style={styles.stateArea}><StateCard loading title="로그인 상태를 확인하고 있어요." /></View></SafeAreaView>;
  }
  if (!user) {
    return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}
        <View style={styles.body}>
          <Text style={styles.title}>새 원픽 등록</Text>
          <StateCard title="로그인하고 원픽을 등록해보세요." text="좋아하는 매장을 찾고, 메뉴와 한줄평을 남기면 내 원픽이 돼요."
            action={{ label: '로그인', variant: 'primary', onPress: () => router.push({
              pathname: '/auth/login',
              params: {
                action: 'store_pick',
                ...(entryProviderId ? { providerId: entryProviderId } : {}),
                ...(entryCategoryId ? { categoryId: entryCategoryId } : {}),
                ...(entryMenuName ? { menuName: entryMenuName } : {}),
              },
            }) }} />
        </View>
      </ScrollView>
    </SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent }) => {
          if (search.isError) return;
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 96) fetchNextStores();
        }}>
        {header}

        {step === 1 ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>1 / 4 · {requesting && requestPart === 'link' ? newStoreName : '오프라인 매장'}</Text>
            <Text style={styles.title}>
              {linkEntry ? '네이버 지도 링크를 입력해주세요.'
                : !requesting ? '상호명을 검색해주세요.' : requestPart === 'name' ? '매장명을 입력해주세요.' : '네이버 지도 링크를 입력해주세요.'}
            </Text>
            {linkEntry ? <>
              <View style={styles.fieldBlock}>
                <TextInput accessibilityLabel="매장 찾기 네이버 지도 링크" autoFocus autoCapitalize="none" keyboardType="url" maxLength={2048}
                  value={entryLink} onChangeText={(value) => { linkRequestRef.current += 1; setEntryLink(extractNaverMapUrl(value) ?? value); linkLookup.reset(); }}
                  onSubmitEditing={findByLink} returnKeyType="search" style={styles.input}
                  placeholder="https://naver.me/…" placeholderTextColor={OnePick.textSecondary} />
                {entryLink.trim() && !validEntryLink
                  ? <Text accessibilityRole="alert" style={styles.error}>네이버 지도 링크를 확인해주세요.</Text>
                  : <Text style={styles.helper}>네이버 지도에서 매장을 열고 공유 → 링크 복사를 눌러주세요.{'\n'}링크의 매장 이름으로 같은 매장을 찾아드려요.</Text>}
              </View>
              {linkLookup.isPending ? <View style={styles.loading}><ActivityIndicator color={OnePick.textPrimary} /></View> : null}
              {linkLookup.isError ? <Text accessibilityRole="alert" style={styles.error}>{linkLookup.error instanceof AppError && linkLookup.error.code === 'RATE_LIMITED'
                ? errorMessage(linkLookup.error) : '링크로 매장을 찾지 못했어요. 링크를 확인하거나 상호명으로 검색해주세요.'}</Text> : null}
              {linkLookup.isSuccess && !linkResult
                ? <Text accessibilityRole="alert" style={styles.error}>네이버 지도의 매장 링크인지 확인해주세요.</Text> : null}
              {linkResult ? <View style={styles.results}>
                <Text style={styles.helper}>{linkSelected
                  ? '링크와 같은 매장을 찾았어요. 지점과 주소를 확인해주세요.'
                  : linkMatches.length > 0
                    ? `${linkName || '링크의 매장'}과(와) 비슷한 매장이에요. 맞는 매장을 골라주세요.`
                    : linkName ? `${linkName}의 메뉴를 등록할 수 있어요.` : '링크에서 매장 이름을 읽지 못했어요.'}</Text>
                {(linkSelected ? [linkSelected] : linkMatches).map((candidate) => <Pressable key={candidate.catalogId}
                  accessibilityRole="button" accessibilityLabel={`${candidate.name} 선택`} onPress={() => pickStore(candidate)}
                  style={({ pressed }) => [styles.resultCard, candidate === linkSelected && styles.resultCardSelected, pressed && styles.flowPressed]}>
                  <View style={styles.resultCardRow}>
                    <View style={styles.resultCopy}>
                      <Text style={styles.resultTitle}>{candidate.name}{candidate.branchName ? ` · ${candidate.branchName}` : ''}</Text>
                      <Text style={styles.resultMeta} numberOfLines={1}>{[candidate.region, candidate.address ? '상세 주소 표시 ›' : candidate.providerCategory].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {candidate === linkSelected ? <Icon name="check" size="sm" color={OnePick.textPrimary} /> : null}
                  </View>
                </Pressable>)}
              </View> : null}
            </> : !requesting ? <>
              <View style={styles.fieldBlock}>
                <FieldLabel label="상호명" />
                <View style={styles.inputWrap}>
                  <TextInput accessibilityLabel="매장명 검색" autoFocus autoCapitalize="none" maxLength={100}
                    onChangeText={(value) => {
                      if (providerPrefillStore) setPrefillDismissed(true);
                      setQuery(value);
                    }}
                    value={storeSearchValue} returnKeyType="search" style={[styles.input, styles.inputWithClear]}
                    placeholderTextColor={OnePick.textSecondary} placeholder="상호명을 입력해주세요." />
                  {storeSearchValue ? <Pressable accessibilityRole="button" accessibilityLabel="매장명 지우기"
                    onPress={() => { setPrefillDismissed(true); setStore(null); setQuery(''); }}
                    style={({ pressed }) => [styles.clearButton, pressed && styles.flowPressed]}>
                    <Icon name="clear" size="sm" color={OnePick.textTertiary} />
                  </Pressable> : null}
                </View>
                {providerPrefillStore
                  ? <Text style={styles.helper}>보고 있던 매장을 선택해 뒀어요. 다른 매장이면 다시 검색해주세요.</Text>
                  : providerPrefill.isLoading
                    ? <Text style={styles.helper}>보고 있던 매장을 확인하고 있어요.</Text>
                    : storeSearchReady && (search.data ?? []).length > 0
                      ? <Text style={styles.helper}>검색 결과 {(search.data ?? []).length}개 · 지점과 주소를 확인해주세요.</Text>
                      : <Text style={styles.helper}>{PLACE_COVERAGE_NOTICE}</Text>}
              </View>
              {search.valid && (search.isWaiting || (search.isFetching && !search.isFetchingNextPage)) ? <View style={styles.loading}><ActivityIndicator color={OnePick.textPrimary} /></View> : null}
              {storeSearchReady && search.isError && !search.isFetchNextPageError ? <StateCard compact tone="danger" title="검색하지 못했어요." action={{ label: '다시 검색해요', onPress: () => { void search.refetch(); } }} /> : null}
              <View style={styles.results}>
                {providerPrefillStore ? <View accessibilityLabel={`${providerPrefillStore.name} 선택됨`}
                  style={[styles.resultCard, styles.resultCardSelected]}>
                  <View style={styles.resultCardRow}>
                    <View style={styles.resultCopy}>
                      <Text style={styles.resultTitle}>{providerPrefillStore.name}{providerPrefillStore.branchName ? ` · ${providerPrefillStore.branchName}` : ''}</Text>
                      <Text style={styles.resultMeta} numberOfLines={1}>
                        {[providerPrefillStore.region, providerPrefillStore.address ? '상세 주소 표시 ›' : providerPrefillStore.providerCategory].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Icon name="check" size="sm" color={OnePick.textPrimary} />
                  </View>
                </View> : (search.data ?? []).filter((candidate) => candidate.kind === 'place').map((candidate) => <Pressable key={candidate.catalogId}
                  accessibilityRole="button" accessibilityLabel={`${candidate.name} 선택`} onPress={() => pickStore(candidate)}
                  style={({ pressed }) => [styles.resultCard, pressed && styles.flowPressed]}>
                  <Text style={styles.resultTitle}>{candidate.name}{candidate.branchName ? ` · ${candidate.branchName}` : ''}</Text>
                  <Text style={styles.resultMeta} numberOfLines={1}>
                    {[candidate.region, candidate.address ? '상세 주소 표시 ›' : candidate.providerCategory].filter(Boolean).join(' · ')}
                  </Text>
                </Pressable>)}
              </View>
              {storeSearchReady && search.isFetchingNextPage ? <View style={styles.loading}>
                <ActivityIndicator color={OnePick.textPrimary} />
                <Text style={styles.helper}>매장을 더 불러오는 중이에요.</Text>
              </View> : null}
              {storeSearchReady && search.isFetchNextPageError && !search.isFetching ? <StateCard compact tone="danger"
                title="다음 매장을 불러오지 못했어요." action={{ label: '다시 불러와요', onPress: fetchNextStores }} /> : null}
              {storeSearchReady && search.isSuccess && !search.isFetching && !search.hasNextPage && (search.data ?? []).length > 0
                ? <Text style={styles.helper}>검색 결과를 모두 확인했어요.</Text> : null}
              {search.valid && !search.isWaiting && !search.isFetching && !search.isError && (search.data ?? []).length === 0
                ? <Text style={styles.helper}>검색한 이름의 매장을 찾지 못했어요.</Text> : null}
            </> : requestPart === 'name' ? <View style={styles.fieldBlock}>
              {/* One input per screen (#593): the store name here, its Naver map link next. */}
              <FieldLabel label="상호명" />
              <TextInput accessibilityLabel="등록 요청 이름" maxLength={100} value={newName} onChangeText={setNewName} style={styles.input}
                placeholder="매장 이름 (지점명 포함)" placeholderTextColor={OnePick.textSecondary} />
              <Text style={styles.helper}>검색한 이름을 넣어뒀어요. 지점이 있으면 지점명까지 적어주세요.</Text>
            </View> : <View style={styles.fieldBlock}>
              <TextInput accessibilityLabel="네이버 지도 링크" autoCapitalize="none" keyboardType="url" maxLength={2048}
                value={mapLink} onChangeText={(value) => setMapLink(extractNaverMapUrl(value) ?? value)} style={styles.input}
                placeholder="https://naver.me/…" placeholderTextColor={OnePick.textSecondary} />
              {mapLink.trim() && !validMapLink
                ? <Text accessibilityRole="alert" style={styles.error}>네이버 지도 링크를 확인해주세요.</Text>
                : <Text style={styles.helper}>네이버 지도에서 매장을 열고 공유 → 링크 복사를 눌러주세요.{'\n'}링크를 붙여넣으면 다음으로 넘어갈 수 있어요.</Text>}
            </View>}
          </View>
          <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
            {linkEntry
              ? !linkResult
                ? <>
                  <FlowButton label="매장명 가져오기" disabled={!validEntryLink} loading={linkLookup.isPending} onPress={findByLink} />
                  {!linkLookup.isPending ? <FlowButton variant="text" label="URL 없음"
                    onPress={() => { linkRequestRef.current += 1; setLinkEntry(false); linkLookup.reset(); }} /> : null}
                </>
                : <>
                  {linkSelected ? <FlowButton label="다음" onPress={() => pickStore(linkSelected)} /> : null}
                  <FlowButton variant={linkSelected || linkMatches.length > 0 ? 'secondary' : 'primary'}
                    label={linkSelected || linkMatches.length > 0 ? '찾는 매장이 없어요.' : linkName ? '다음' : '매장 이름 입력하기'}
                    onPress={registerFromLink} />
                </>
              : !requesting && providerPrefillStore
              ? <FlowButton label="다음" onPress={() => pickStore(providerPrefillStore)} />
              : !requesting
                ? <FlowButton variant="secondary" label="찾는 매장이 없어요."
                    onPress={() => { setRequesting(true); setRequestPart('name'); setNewName(query); setMapLink(''); setNameOnlyFromLink(false); }} />
              : requestPart === 'name'
                ? <FlowButton label="다음" disabled={!validNewName} onPress={() => {
                    if (nameOnlyFromLink && validMapLink) pickStore({ kind: 'new', name: newStoreName, channel: 'offline', mapUrl: mapLink.trim() });
                    else setRequestPart('link');
                  }} />
                : <FlowButton label="다음" disabled={!canRequest}
                    onPress={() => pickStore({ kind: 'new', name: newStoreName, channel: 'offline', mapUrl: mapLink.trim() })} />}
          </View>
        </> : null}

        {step === 2 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>2 / 4 · {storeDisplayName}</Text>
            <Text style={styles.helper} accessibilityLiveRegion="polite">{storeDisplayName} 매장을 선택했어요.</Text>
            <Text style={styles.title}>어떤 메뉴인가요?</Text>
            <View style={styles.fieldBlock}>
              <FieldLabel label="메뉴명" />
              <View style={styles.inputWrap}>
                <TextInput accessibilityLabel="메뉴 이름" maxLength={40} value={menuQuery}
                  onChangeText={(value) => {
                    setResumeStep(null);
                    setMenuPrefilled(false);
                    setMenuQuery(value); setMenu(null); setAiMenuName('');
                    setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null);
                    setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
                  }}
                  onSubmitEditing={() => { if (menus.isSuccess && requestedMenu && exactMenuMatches.length !== 1 && !prefilledMenu) setAiMenuName(requestedMenu); }}
                  returnKeyType="search" style={[styles.input, styles.inputWithClear]} placeholder="예: 미역국" placeholderTextColor={OnePick.textSecondary} />
                {menuQuery ? <Pressable accessibilityRole="button" accessibilityLabel="메뉴명 지우기"
                  onPress={() => {
                    setResumeStep(null);
                    setMenuPrefilled(false);
                    setMenuQuery(''); setMenu(null); setAiMenuName('');
                    setItemId(null); setItemHadPhoto(false); setItemPending(false); setPreflight(null); setPickScope(null);
                    setPickChangedElsewhere(false); setExpectedPreviousPickId(undefined); requestIdRef.current = null;
                  }}
                  style={({ pressed }) => [styles.clearButton, pressed && styles.flowPressed]}>
                  <Icon name="clear" size="sm" color={OnePick.textTertiary} />
                </Pressable> : null}
              </View>
              <Text style={styles.helper}>{menuPrefilled && entryMenuName
                ? '매장 메뉴명으로 고쳐 써도 돼요.'
                : '매장 메뉴명을 적어주세요.'}</Text>
            </View>

            {menus.isError && !effectiveMenu ? <StateCard compact tone="danger" title="카테고리를 불러오지 못했어요."
              action={{ label: '다시 불러오기', onPress: () => { void menus.refetch(); } }} /> : null}

            {effectiveMenu ? <Text style={styles.helper}>
              메뉴를 확인했어요. 다음으로 넘어가주세요.
            </Text> : null}
            {classificationPending ? <View style={styles.loadingRow}>
              <ActivityIndicator color={OnePick.textPrimary} /><Text style={styles.helperInline}>메뉴를 확인하고 있어요.</Text>
            </View> : null}
            {classificationUnresolved ? <StateCard compact title="메뉴를 분류하지 못했어요."
              text="입력한 내용은 유지돼요. 메뉴 이름을 확인하거나 다시 시도해주세요."
              action={{ label: '다시 확인하기', onPress: () => { void suggestions.refetch(); } }} /> : null}
            {preflight?.brand ? <View style={styles.fieldBlock}>
              <FieldLabel label="원픽 범위" />
              <Text style={styles.helper}>지점을 고르면 이 매장만, 브랜드 전체를 고르면 모든 지점과 별개의 원픽이 돼요.</Text>
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
          <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
            <FlowButton label={preflight?.brand && !pickScope ? '범위 선택하기' : '다음'}
              disabled={!effectiveMenu || Boolean(preflight?.brand && !pickScope)}
              loading={selectItem.isPending} onPress={() => void confirmMenu(resumeStep ?? undefined)} />
          </View>
        </> : null}

        {step === 4 && store ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>3 / 4 · {pickDisplayName} · {menu?.name ?? '사진'}</Text>
            <Text style={styles.title}>대표 사진을 올려주세요.</Text>
            <Text style={styles.helper}>{needsPhoto
              ? `이 메뉴에는 아직 사진이 없어요. 올린 사진은 관리자 검수 후 ${pickDisplayName} ${menu?.name ?? '메뉴'}의 대표 사진으로 쓰여요.`
              : '이미 대표 사진이 있어 사진 단계는 자동으로 건너뛰어요.'}</Text>
            {needsPhoto ? <View style={styles.photoPanel}>
              {photoReselect && !photo
                ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.noticeText}>사진을 다시 선택해주세요.</Text></View> : null}
              {photo ? <>
                <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="선택한 대표 이미지 미리보기" />
                <FlowButton variant="secondary" label="다른 사진 고르기" loading={choosePhoto.isPending} onPress={() => void pickNewPhoto()} />
                <FlowButton variant="text" label="사진 빼기" onPress={() => setPhoto(null)} />
              </> : <Pressable accessibilityRole="button" accessibilityLabel="사진 고르기"
                accessibilityState={{ disabled: choosePhoto.isPending, busy: choosePhoto.isPending }}
                disabled={choosePhoto.isPending} onPress={() => void pickNewPhoto()}
                style={({ pressed }) => [styles.photoPicker, pressed && !choosePhoto.isPending && styles.flowPressed]}>
                {choosePhoto.isPending ? <ActivityIndicator color={OnePick.textPrimary} /> : <Text style={styles.photoPickerText}>사진 고르기</Text>}
              </Pressable>}
            </View> : <StateCard compact title="사진을 등록했어요." />}
          </View>
          <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
            <FlowButton label="다음" disabled={needsPhoto && !photo} onPress={() => setStep(5)} />
          </View>
        </> : null}

        {(step === 5 || step === 6) && store && menu ? <>
          <View style={styles.body}>
            <Text style={styles.stepMeta}>4 / 4 · {pickDisplayName} · {menu.name}</Text>
            <Text style={styles.title}>한줄평을 남겨주세요.</Text>
            {pickChangedElsewhere
              ? <View style={styles.notice}><Text style={styles.noticeText}>다른 기기에서 이 메뉴의 원픽이 바뀌었어요. 다시 등록하면 방금 확인한 최신 원픽을 기준으로 교체해요.</Text></View>
              : !itemPending && replacingVisiblePick
                ? <View style={styles.notice}><Text style={styles.noticeText}>저장하면 이 메뉴의 매장 원픽이 바뀌어요.</Text></View> : null}
            <View style={styles.fieldBlock}>
              <FieldLabel label="한줄평" />
              <TextInput accessibilityLabel="원픽 한줄평" multiline maxLength={100} editable={!saving && step !== 6} value={review}
                onChangeText={(value) => { setReview(value); setShowReviewError(false); setConfirmReplacement(false); }} style={[styles.input, styles.reviewInput]}
                placeholder="예: 국물이 진한데 부담스럽지 않아요." placeholderTextColor={OnePick.textSecondary} />
            </View>
            <Text style={styles.counter}>{review.length} / 100자</Text>
            {showReviewError && !reviewValid ? <Text accessibilityRole="alert" style={styles.error}>한줄평을 1~100자로 입력해주세요.</Text> : null}
            {saveError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(saveError)}</Text> : null}
          </View>
          <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
            {confirmReplacement && !pickChangedElsewhere ? <>
              <Text accessibilityRole="alert" style={styles.noticeText}>이 메뉴의 기존 원픽을 바꿀까요?{'\n'}새 원픽 · {pickDisplayName}</Text>
              <FlowButton label="원픽 바꾸기" loading={saving} disabled={step === 6}
                onPress={() => void save()} />
              <FlowButton variant="secondary" label="돌아가기" disabled={saving || step === 6}
                onPress={() => setConfirmReplacement(false)} />
            </> : <FlowButton label={pickChangedElsewhere ? '변경 확인 후 등록하기' : '원픽 등록하기'}
              loading={saving || currentPickSlot.isPending} disabled={step === 6}
              onPress={() => {
                if (!reviewValid) { setShowReviewError(true); return; }
                if (pickChangedElsewhere) { void confirmChangedPickAndSave(); return; }
                if (replacingVisiblePick) { setConfirmReplacement(true); return; }
                void save();
              }} /> }
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
  headerTitle: { ...OnePickType.headline, flex: 1, color: OnePick.textPrimary, textAlign: 'center' },
  headerAction: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  body: { flexGrow: 1, gap: OnePickSpace.md, paddingTop: OnePickSpace.md, paddingHorizontal: OnePickSpace.gutter },
  footer: {
    gap: OnePickSpace.sm,
    marginTop: 'auto',
    paddingTop: OnePickSpace.lg,
    paddingHorizontal: OnePickSpace.gutter,
  },
  stepMeta: { ...OnePickType.caption, color: OnePick.textSecondary },
  title: { ...OnePickType.pageTitle, color: OnePick.textPrimary },
  channelChoice: { gap: OnePickSpace.sm, marginTop: OnePickSpace.xs },
  fieldBlock: { gap: OnePickSpace.sm },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: OnePickSpace.xs },
  fieldLabel: { ...OnePickType.bodyMedium, color: OnePick.textSecondary },
  fieldRequired: { ...OnePickType.bodyMedium, color: OnePick.textAccent },
  inputWrap: { position: 'relative' },
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
  inputWithClear: { paddingRight: 52 },
  clearButton: {
    position: 'absolute',
    right: OnePickSpace.xs,
    top: 4,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  resultCardSelected: { borderWidth: 1, borderColor: OnePick.actionPrimary, backgroundColor: OnePick.bgDefault },
  resultCardRow: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  resultCopy: { flex: 1, minWidth: 0, gap: OnePickSpace.xs },
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
  flowButtonText: { minHeight: 44, paddingHorizontal: 0, backgroundColor: 'transparent' },
  flowButtonDisabled: { backgroundColor: OnePick.actionDisabled, borderWidth: 0 },
  flowButtonLabel: { ...OnePickType.bodyMedium, color: OnePick.onAction },
  flowButtonLabelDark: { color: OnePick.textPrimary },
  flowPressed: { opacity: 0.88 },
  photoPanel: { gap: OnePickSpace.md },
  photoPicker: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: OnePick.borderStrong,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgSubtle,
  },
  photoPickerText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: OnePickRadius.md,
    backgroundColor: OnePick.bgSubtle,
  },
  notice: { padding: OnePickSpace.md, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgAccentSubtle },
  noticeText: { ...OnePickType.caption, color: OnePick.textPrimary },
  counter: { ...OnePickType.caption, alignSelf: 'stretch', color: OnePick.textSecondary, textAlign: 'right' },
});
