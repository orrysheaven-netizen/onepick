import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark, Button, Chip, StateCard } from '@/components/ui';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useApplyItemCategory, useItemCategorySuggestions, useSetItemCategoryHint } from '@/hooks/useItemCategoryAi';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useChoosePhoto, useImportItemPhoto, useRegisterPick, useRegistrationCategories } from '@/hooks/useRegisterPick';
import { isPhotoFailure, showPhotoFailure } from '@/lib/photos/photoFailure';
import { CATEGORY_HINT_MAX_LENGTH } from '@/services/registrationService';
import type { PickPhotoDraft } from '@/types/domain/photo';
import { OnePick } from '@/constants/onepick';

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'PHOTO_INVALID') return '사진을 읽지 못했어요. JPG·PNG 사진을 다시 선택해주세요.';
    if (error.code === 'PHOTO_TOO_LARGE') return '사진이 서버의 최대 저장 용량을 초과했어요. 다른 사진을 선택해주세요.';
    if (error.code === 'PHOTO_UPLOAD_FAILED') return '사진 파일은 정상적으로 읽었지만 서버 저장에 실패했어요. 선택한 사진은 유지됩니다. 다시 시도해주세요.';
    if (error.code === 'IMAGE_SOURCE_UNSUPPORTED') return '지원하는 제조사 사이트의 HTTPS 링크를 넣어주세요. 다른 링크는 직접 사진 선택을 이용해주세요.';
    if (error.code === 'IMAGE_IMPORT_FAILED') return '링크에서 사진을 가져오지 못했어요. 직접 사진 선택을 이용해주세요.';
    if (error.code === 'CATEGORY_NOT_PICKABLE') return '현재 등록 요청을 받을 수 없는 카테고리예요.';
    if (error.code === 'ITEM_NAME_INVALID') return '제품명은 1~100자로 입력해주세요.';
    if (error.code === 'RATE_LIMITED') return '등록 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '사용자명을 먼저 정해주세요.';
  }
  return '상품을 등록하지 못했어요. 다시 시도해주세요.';
}

function hintErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'CATEGORY_LABEL_INVALID') return `카테고리 힌트는 1~${CATEGORY_HINT_MAX_LENGTH}자로 적어주세요.`;
    if (error.code === 'ITEM_NOT_ELIGIBLE') return '이 요청은 이미 검수가 끝나 힌트를 바꿀 수 없어요.';
    if (error.code === 'AUTH_REQUIRED') return '로그인 상태를 다시 확인해주세요.';
  }
  return '카테고리 힌트를 보내지 못했어요. 적은 내용은 그대로 있으니 다시 시도해주세요.';
}

type Params = { categoryId?: string; itemName?: string };

export default function RequestItemScreen() {
  const params = useLocalSearchParams<Params>();
  const auth = useAuthSession();
  return <RequestItemForm key={JSON.stringify([auth.user?.id ?? 'anon', params.categoryId, params.itemName])} auth={auth} params={params} />;
}

function RequestItemForm({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const categories = useRegistrationCategories();
  const profile = useMyProfile(auth.user?.id);
  const registration = useRegisterPick();
  const photoPicker = useChoosePhoto();
  const imageImport = useImportItemPhoto();
  const busy = useRef(false);
  const [name, setName] = useState(typeof params.itemName === 'string' ? params.itemName : '');
  const categoryId = typeof params.categoryId === 'string' ? params.categoryId : '';
  const [submittedItem, setSubmittedItem] = useState<{ id: string; name: string } | null>(null);
  const [selectedSuggestedCategoryId, setSelectedSuggestedCategoryId] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [appliedCategoryLabel, setAppliedCategoryLabel] = useState<string | null>(null);
  const [hintMode, setHintMode] = useState(false);
  const [hintText, setHintText] = useState('');
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const classifying = !categoryId && !appliedCategoryLabel && !savedHint;
  const categorySuggestions = useItemCategorySuggestions(classifying ? submittedItem?.id : undefined);
  const applyCategory = useApplyItemCategory(classifying ? submittedItem?.id : undefined);
  const categoryHint = useSetItemCategoryHint(classifying ? submittedItem?.id : undefined, auth.user?.id);
  const normalizedHint = hintText.trim().replace(/\s+/g, ' ');
  const canSendHint = normalizedHint.length >= 1 && normalizedHint.length <= CATEGORY_HINT_MAX_LENGTH
    && !categoryHint.isPending && !applyCategory.isPending;
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [imageLink, setImageLink] = useState('');
  const submitting = registration.isPending || photoPicker.isPending || imageImport.isPending;

  const selectedCategory = categories.data?.find((category) => category.id === categoryId);
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const isValid = normalizedName.length >= 1 && normalizedName.length <= 100
    && (!categoryId || Boolean(selectedCategory));
  const canSubmit = isValid && (!categoryId || (!categories.isPending && !categories.isError)) && !auth.isLoading && !auth.error
    && !submitting && (!auth.user || Boolean(profile.data && !profile.isPending && !profile.isError));
  const intent = useMemo(() => ({
    action: 'request_item' as const,
    itemName: normalizedName,
    ...(categoryId ? { categoryId } : {}),
  }), [categoryId, normalizedName]);

  const getPhoto = async (fromLink: boolean) => {
    if (busy.current || submitting) return;
    if (!auth.user) {
      router.push({ pathname: '/auth/login', params: intent });
      return;
    }
    busy.current = true;
    photoPicker.reset(); imageImport.reset(); registration.reset();
    try {
      const result = fromLink ? await imageImport.mutateAsync(imageLink) : await photoPicker.mutateAsync();
      if (result) setPhoto(result);
    } catch (error) {
      showPhotoFailure(error, fromLink ? 'request_item_photo_import' : 'request_item_photo_choose');
      // Keep the previous photo on cancellation/failure; mutation state also keeps the inline error visible.
    } finally {
      busy.current = false;
    }
  };

  const submit = async () => {
    if (!canSubmit || busy.current) return;
    if (!auth.user) {
      router.push({ pathname: '/auth/login', params: intent });
      return;
    }
    busy.current = true;
    try {
      const result = await registration.mutateAsync({
        userId: auth.user.id,
        categoryId: categoryId || undefined,
        itemName: normalizedName,
        variant: '',
        oneLineReview: '',
        photo,
      });

      if (result.type === 'pending_item') {
        setSubmittedItem({ id: result.item.id, name: result.item.name });
        return;
      }

      if (result.type === 'existing_item') {
        router.replace({
          pathname: '/pick/choose',
          params: { itemId: result.item.id, categoryId: result.item.categoryId },
        });
        return;
      }

      router.replace({ pathname: '/pick/[pickId]', params: { pickId: result.pick.id } });
    } catch (error) {
      if (photo && isPhotoFailure(error)) showPhotoFailure(error, 'request_item_photo_upload');
      // Mutation state renders the error without losing the draft.
    } finally {
      busy.current = false;
    }
  };

  const applySelectedCategory = async () => {
    if (!submittedItem || !selectedSuggestedCategoryId || applyCategory.isPending) return;
    const option = categorySuggestions.data?.categories.find((entry) => entry.categoryId === selectedSuggestedCategoryId);
    try {
      const result = await applyCategory.mutateAsync(selectedSuggestedCategoryId);
      if (result.type === 'existing_item') {
        router.replace({
          pathname: '/pick/choose',
          params: { itemId: result.itemId, categoryId: result.categoryId },
        });
        return;
      }
      setAppliedCategoryLabel(option?.label ?? '선택한 카테고리');
    } catch {
      // Keep the chosen category so the user can retry or leave it for later.
    }
  };

  const sendCategoryHint = async () => {
    if (!submittedItem || !canSendHint) return;
    try {
      await categoryHint.mutateAsync(normalizedHint);
      setSavedHint(normalizedHint);
    } catch {
      // Mutation state renders the error; keep the typed hint for retry.
    }
  };

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><StateCard loading title="로그인 상태를 확인하고 있어요" /></View></SafeAreaView>;
  }

  if (auth.error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <StateCard tone="danger" title="로그인 상태를 확인하지 못했어요" action={{ label: '로그인 상태 다시 확인', variant: 'secondary', onPress: () => void auth.retry() }} />
        </View>
      </SafeAreaView>
    );
  }

  if (auth.user && profile.error instanceof AppError && profile.error.code === 'PROFILE_NOT_FOUND') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <StateCard title="사용자명을 먼저 정해주세요" text="제품 요청을 남긴 사람을 연결하기 위해 프로필이 필요합니다."
            action={{ label: '사용자명 만들기', variant: 'primary', onPress: () => router.push({ pathname: '/auth/username', params: intent }) }} />
        </View>
      </SafeAreaView>
    );
  }

  if (submittedItem) {
    if (categoryId) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <StateCard title="상품을 등록했어요" text={`${submittedItem.name}\n확인 후 원픽으로 선택할 수 있어요. 진행 상태는 내 프로필에서 볼 수 있습니다.`}
              action={{ label: '내 등록 요청 보기', variant: 'primary', onPress: () => router.replace('/(tabs)/profile') }} />
            <Button variant="ghost" label="홈으로 돌아가기" onPress={() => router.replace('/')} style={styles.centered} />
          </View>
        </SafeAreaView>
      );
    }

    if (appliedCategoryLabel) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <StateCard title="카테고리를 적용했어요" text={`${submittedItem.name} · ${appliedCategoryLabel}\n최종 선택은 직접 적용되었습니다. 관리자 확인 후 승인된 제품을 원픽으로 선택할 수 있어요.`}
              action={{ label: '내 등록 요청 보기', variant: 'primary', onPress: () => router.replace('/(tabs)/profile') }} />
            <Button variant="ghost" label="홈으로 돌아가기" onPress={() => router.replace('/')} style={styles.centered} />
          </View>
        </SafeAreaView>
      );
    }

    if (savedHint) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <StateCard title="카테고리 힌트를 남겼어요" text={`${submittedItem.name} · ${savedHint}\n관리자가 힌트를 참고해 카테고리를 정하고 승인해요. 승인된 제품은 내 프로필에서 원픽으로 선택할 수 있어요.`}
              action={{ label: '내 등록 요청 보기', variant: 'primary', onPress: () => router.replace('/(tabs)/profile') }} />
            <Button variant="ghost" label="홈으로 돌아가기" onPress={() => router.replace('/')} style={styles.centered} />
          </View>
        </SafeAreaView>
      );
    }

    const suggestionIds = new Set(categorySuggestions.data?.suggestions.map((entry) => entry.categoryId) ?? []);
    const manualCategories = categorySuggestions.data?.categories.filter((entry) => !suggestionIds.has(entry.categoryId)) ?? [];
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>AI가 카테고리를 추천했어요</Text>
          <Text style={styles.requestedNameLeft}>{submittedItem.name}</Text>
          <Text style={styles.subtitle}>가장 잘 맞는 카테고리를 선택해주세요. AI의 추천은 자동으로 적용되지 않습니다.</Text>

          {categorySuggestions.isPending ? (
            <View style={styles.block}><StateCard loading title="상품명과 기존 카테고리를 비교하고 있어요" /></View>
          ) : categorySuggestions.isError ? (
            <View style={styles.block}><StateCard tone="danger" title="AI 추천을 불러오지 못했어요" text="상품 등록은 유지됩니다. 다시 시도하거나 카테고리를 나중에 정할 수 있어요."
              action={{ label: 'AI 추천 다시 받기', onPress: () => void categorySuggestions.refetch() }} /></View>
          ) : categorySuggestions.data ? (
            <View style={styles.suggestionCard}>
              <Text style={styles.suggestionTitle}>추천 카테고리</Text>
              {categorySuggestions.data.suggestions.length > 0 ? categorySuggestions.data.suggestions.map((suggestion) => {
                const selected = selectedSuggestedCategoryId === suggestion.categoryId;
                return (
                  <Pressable key={suggestion.categoryId} accessibilityRole="radio"
                    accessibilityLabel={`${suggestion.label} 추천 카테고리 선택`}
                    accessibilityState={{ selected, disabled: applyCategory.isPending }}
                    disabled={applyCategory.isPending}
                    onPress={() => setSelectedSuggestedCategoryId(suggestion.categoryId)}
                    style={[styles.suggestionOption, selected && styles.suggestionOptionSelected]}>
                    <Text style={[styles.suggestionLabel, selected && styles.suggestionLabelSelected]}>{suggestion.label}</Text>
                    <Text style={styles.suggestionReason}>{suggestion.reason}</Text>
                  </Pressable>
                );
              }) : (
                <Text style={styles.helper}>현재 카테고리 중에는 충분히 맞는 후보를 찾지 못했어요.</Text>
              )}

              {categorySuggestions.data.needsNewCategory ? (
                <Text style={styles.categoryGapNotice}>딱 맞는 기존 카테고리가 없을 수 있어요. 억지로 적용하지 않아도 됩니다.</Text>
              ) : null}

              {manualCategories.length > 0 ? (
                <Button variant="ghost" size="sm" style={styles.inlineAction} onPress={() => setShowAllCategories((value) => !value)}
                  label={showAllCategories ? '직접 선택 닫기' : '다른 카테고리 직접 선택'} />
              ) : null}

              {showAllCategories ? (
                <View style={styles.manualCategoryList}>
                  {manualCategories.map((option) => {
                    const selected = selectedSuggestedCategoryId === option.categoryId;
                    return (
                      <Chip key={option.categoryId} label={option.label} selected={selected} accessibilityLabel={`${option.label} 직접 카테고리 선택`}
                        onPress={applyCategory.isPending ? undefined : () => setSelectedSuggestedCategoryId(option.categoryId)} />
                    );
                  })}
                </View>
              ) : null}

              {applyCategory.isError ? <Text style={styles.error}>카테고리를 적용하지 못했어요. 선택은 유지되니 다시 시도하거나 나중에 정할 수 있어요.</Text> : null}

              <Button size="lg" fullWidth label="이 카테고리 적용" disabled={!selectedSuggestedCategoryId} loading={applyCategory.isPending}
                onPress={() => void applySelectedCategory()} style={styles.primaryAction} />
            </View>
          ) : null}

          <View style={styles.hintCard}>
            <Text style={styles.suggestionTitle}>맞는 카테고리가 없나요?</Text>
            <Text style={styles.helper}>원하는 카테고리를 직접 적어주세요. 관리자가 힌트를 참고해 실제 카테고리를 정합니다.</Text>
            {hintMode ? <>
              <TextInput
                accessibilityLabel="원하는 카테고리"
                editable={!categoryHint.isPending}
                maxLength={CATEGORY_HINT_MAX_LENGTH}
                onChangeText={(value) => { setHintText(value); if (categoryHint.isError) categoryHint.reset(); }}
                placeholder="예: 텀블러, 캠핑 의자, 반려동물 간식"
                placeholderTextColor={OnePick.hint}
                style={[styles.input, styles.hintInput]}
                value={hintText}
              />
              <Text style={styles.helper}>{normalizedHint.length}/{CATEGORY_HINT_MAX_LENGTH}</Text>
              {categoryHint.isError ? <Text accessibilityRole="alert" style={styles.error}>{hintErrorMessage(categoryHint.error)}</Text> : null}
              <Button size="lg" fullWidth label="카테고리 힌트 보내기" disabled={!canSendHint} loading={categoryHint.isPending}
                onPress={() => void sendCategoryHint()} style={styles.hintSubmit} />
            </> : (
              <Button variant="ghost" size="sm" style={styles.inlineAction} label="카테고리 직접 적기" onPress={() => setHintMode(true)} />
            )}
          </View>

          <View style={styles.laterRow}>
            <Button variant="ghost" label="카테고리는 나중에 정하기" onPress={() => router.replace('/(tabs)/profile')} />
            <Button variant="ghost" label="홈으로 돌아가기" onPress={() => router.replace('/')} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" disabled={submitting} style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.markRow}><BrandMark size="sm" /><Text style={styles.markLabel}>새로운 원픽의 시작</Text></View>
        <Text style={styles.title}>원픽 등록</Text>
        <Text style={styles.subtitle}>찾는 상품이 없나요? 상품명을 등록해주세요. 등록 후 AI가 카테고리를 추천하고, 원하는 카테고리를 직접 선택할 수 있습니다.</Text>

        <Text style={styles.label}>제품명</Text>
        <TextInput
          accessibilityLabel="요청 제품명"
          editable={!submitting}
          maxLength={100}
          onChangeText={setName}
          placeholder="제품명"
          placeholderTextColor={OnePick.hint}
          style={styles.input}
          value={name}
        />

        {categoryId ? <>
          <Text style={styles.label}>선택한 콘텐츠 종류</Text>
          {categories.isPending ? <ActivityIndicator /> : categories.isError ? (
            <View>
              <Text style={styles.error}>선택한 종류를 확인하지 못했어요. 입력한 내용은 그대로 있어요.</Text>
              <Button variant="ghost" size="sm" style={styles.inlineAction} label="종류 다시 확인하기" onPress={() => void categories.refetch()} />
            </View>
          ) : selectedCategory ? <Text style={styles.selectedCategory}>{selectedCategory.label ?? selectedCategory.name}</Text>
            : <Text style={styles.error}>선택한 콘텐츠 종류를 사용할 수 없어요. 검색 화면에서 다시 선택해주세요.</Text>}
        </> : <View style={styles.notice}>
          <Text style={styles.noticeText}>지금은 상품명만 등록하면 됩니다. 등록 후 AI 추천에서 고르거나, 맞는 카테고리가 없으면 직접 힌트를 적을 수 있어요.</Text>
        </View>}

        <View style={styles.photoCard}>
          <Text style={styles.photoTitle}>제품 대표 이미지 · 선택</Text>
          <Text style={styles.helper}>승인된 대표 사진 한 장을 같은 제품을 고른 사람들이 함께 사용해요.</Text>
          {auth.user ? <>
            <Button variant="soft" fullWidth disabled={submitting} label={photo ? '사진 바꾸기' : '직접 사진 선택'} onPress={() => void getPhoto(false)} style={styles.photoButton} />
            <Text style={styles.helper}>또는 제조사 제품·이미지 링크에서 가져올 수 있어요.</Text>
            <TextInput accessibilityLabel="제품 이미지 링크" editable={!submitting} value={imageLink} onChangeText={setImageLink}
              autoCapitalize="none" keyboardType="url" maxLength={2048} placeholder="https://…" style={[styles.input, styles.linkInput]} />
            <Button variant="ghost" size="sm" style={styles.inlineAction} disabled={submitting || !imageLink.trim()} label="링크에서 이미지 가져오기" onPress={() => void getPhoto(true)} />
          </> : <Button variant="soft" fullWidth label="로그인하고 사진 추가" onPress={() => router.push({ pathname: '/auth/login', params: intent })} style={styles.photoButton} />}
          {photoPicker.isPending || imageImport.isPending ? <View style={styles.photoLoading}><ActivityIndicator /><Text style={styles.helper}>사진을 준비하고 있어요</Text></View> : null}
          {photoPicker.isError || imageImport.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(photoPicker.error ?? imageImport.error)}</Text> : null}
          {photo ? <>
            <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="contain" accessibilityLabel="제품 대표 이미지 미리보기" />
            <Button variant="ghost" size="sm" style={styles.inlineAction} disabled={submitting} label="사진 제거" onPress={() => { setPhoto(null); photoPicker.reset(); imageImport.reset(); registration.reset(); }} />
          </> : null}
          <Text style={styles.helper}>사용 권한이 있는 사진을 선택해주세요. 선택한 사진은 요청을 보낼 때 크기를 줄인 이미지로 저장됩니다.</Text>
        </View>

        {!auth.user ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>요청을 보내기 전에 로그인합니다. 지금 입력한 제품 정보는 로그인 후 그대로 이어집니다.</Text>
          </View>
        ) : null}

        {auth.user && profile.isPending ? <Text style={styles.helper}>프로필을 확인하고 있어요</Text> : null}
        {auth.user && profile.isError ? (
          <View>
            <Text style={styles.error}>프로필을 불러오지 못했어요. 다시 확인한 뒤 요청해주세요.</Text>
            <Button variant="ghost" size="sm" style={styles.inlineAction} label="프로필 다시 불러오기" onPress={() => void profile.refetch()} />
          </View>
        ) : null}

        {registration.isError ? <Text style={styles.error}>{errorMessage(registration.error)}</Text> : null}

        <Button size="lg" fullWidth disabled={!canSubmit && !registration.isPending} loading={registration.isPending}
          label={auth.user ? '상품 등록하기' : '로그인하고 등록하기'} onPress={() => void submit()} style={styles.primaryAction} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: OnePick.background },
  content: { width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  block: { marginTop: 22 },
  centered: { alignSelf: 'center' },
  inlineAction: { alignSelf: 'flex-start', marginTop: 6 },
  primaryAction: { marginTop: 22 },
  laterRow: { alignItems: 'center', marginTop: 12 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  markLabel: { color: OnePick.accentDeep, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  center: { flex: 1, width: '100%', maxWidth: OnePick.maxWidth, alignSelf: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  backButton: { width: 44, minHeight: 44, justifyContent: 'center', marginLeft: -8, marginTop: 4, paddingLeft: 8 },
  back: { color: OnePick.text, fontSize: 36, lineHeight: 42 },
  title: { color: OnePick.text, fontSize: 26, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, marginTop: 8 },
  subtitle: { color: OnePick.muted, fontSize: 14, lineHeight: 20, marginTop: 10 },
  label: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  input: { minHeight: 52, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, paddingHorizontal: 16, color: OnePick.text, fontSize: 15 },
  selectedCategory: { color: OnePick.accentDeep, fontSize: 13, lineHeight: 18, fontWeight: '600', marginBottom: 8 },
  helper: { color: OnePick.muted, fontSize: 13, lineHeight: 18, marginTop: 10 },
  notice: { backgroundColor: OnePick.accentSoft, borderRadius: 20, padding: 14, marginTop: 18 },
  noticeText: { color: OnePick.accentDeep, fontSize: 14, lineHeight: 20 },
  error: { color: OnePick.danger, fontSize: 13, lineHeight: 18, marginTop: 14 },
  requestedNameLeft: { color: OnePick.text, fontSize: 19, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4, marginTop: 14 },
  photoCard: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 16, marginTop: 24 },
  photoTitle: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  photoButton: { marginTop: 14 },
  photoPreview: { width: '100%', height: 220, backgroundColor: OnePick.sunken, borderRadius: 12, marginTop: 12 },
  photoLoading: { alignItems: 'center', paddingVertical: 10 },
  suggestionCard: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 16, marginTop: 22 },
  hintCard: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 16, marginTop: 14 },
  hintInput: { marginTop: 12 },
  hintSubmit: { marginTop: 14 },
  suggestionTitle: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  suggestionOption: { borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, padding: 14, marginTop: 10 },
  suggestionOptionSelected: { borderColor: OnePick.accent, backgroundColor: OnePick.accentSoft },
  suggestionLabel: { color: OnePick.text, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  suggestionLabelSelected: { color: OnePick.accentDeep },
  suggestionReason: { color: OnePick.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  categoryGapNotice: { color: OnePick.muted, backgroundColor: OnePick.sunken, borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 18, marginTop: 12 },
  manualCategoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  linkInput: { marginTop: 10 },
});
