import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useApplyItemCategory, useItemCategorySuggestions } from '@/hooks/useItemCategoryAi';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useChoosePhoto, useImportItemPhoto, useRegisterPick, useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { PickPhotoDraft } from '@/types/domain/photo';

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'PHOTO_INVALID') return '사진을 읽지 못했어요. JPG·PNG 사진을 다시 선택해주세요.';
    if (error.code === 'PHOTO_TOO_LARGE') return '사진 용량이 너무 커 자동 최적화할 수 없어요. 다른 사진을 선택해주세요.';
    if (error.code === 'PHOTO_UPLOAD_FAILED') return '사진 파일은 정상적으로 읽었지만 서버 저장에 실패했어요. 선택한 사진은 유지됩니다. 다시 시도해주세요.';
    if (error.code === 'IMAGE_SOURCE_UNSUPPORTED') return '지원하는 제조사 사이트의 HTTPS 링크를 넣어주세요. 다른 링크는 직접 사진 선택을 이용해주세요.';
    if (error.code === 'IMAGE_IMPORT_FAILED') return '링크에서 사진을 가져오지 못했어요. 직접 사진 선택을 이용해주세요.';
    if (error.code === 'CATEGORY_NOT_PICKABLE') return '현재 등록 요청을 받을 수 없는 카테고리예요.';
    if (error.code === 'ITEM_NAME_INVALID') return '제품명은 1~100자로 입력해주세요.';
    if (error.code === 'RATE_LIMITED') return '등록 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '사용자명을 먼저 정해주세요.';
  }
  return '제품 등록 요청을 보내지 못했어요. 다시 시도해주세요.';
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
  const categorySuggestions = useItemCategorySuggestions(!categoryId && !appliedCategoryLabel ? submittedItem?.id : undefined);
  const applyCategory = useApplyItemCategory(!categoryId && !appliedCategoryLabel ? submittedItem?.id : undefined);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [photoApproved, approvePhoto] = useState(false);
  const [imageLink, setImageLink] = useState('');
  const submitting = registration.isPending || photoPicker.isPending || imageImport.isPending;

  const selectedCategory = categories.data?.find((category) => category.id === categoryId);
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const isValid = normalizedName.length >= 1 && normalizedName.length <= 100
    && (!categoryId || Boolean(selectedCategory));
  const canSubmit = isValid && (!categoryId || (!categories.isPending && !categories.isError)) && !auth.isLoading && !auth.error
    && !submitting && (!photo || photoApproved) && (!auth.user || Boolean(profile.data && !profile.isPending && !profile.isError));
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
      if (result) { setPhoto(result); approvePhoto(false); }
    } catch {
      // Keep the previous photo on cancellation/failure; mutation state explains the error.
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
    } catch {
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

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator /><Text style={styles.stateText}>로그인 상태를 확인하고 있어요</Text></View></SafeAreaView>;
  }

  if (auth.error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.stateTitle}>로그인 상태를 확인하지 못했어요</Text>
          <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => void auth.retry()}>
            <Text style={styles.primaryButtonText}>로그인 상태 다시 확인</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (auth.user && profile.error instanceof AppError && profile.error.code === 'PROFILE_NOT_FOUND') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.stateTitle}>사용자명을 먼저 정해주세요</Text>
          <Text style={styles.stateText}>제품 요청을 남긴 사람을 연결하기 위해 프로필이 필요합니다.</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.push({ pathname: '/auth/username', params: intent })}>
            <Text style={styles.primaryButtonText}>사용자명 만들기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (submittedItem) {
    if (categoryId) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <Text style={styles.kicker}>REQUEST SENT</Text>
            <Text style={styles.stateTitle}>제품 등록 요청을 보냈어요</Text>
            <Text style={styles.requestedName}>{submittedItem.name}</Text>
            <Text style={styles.stateText}>내 프로필에서 승인 상태를 확인할 수 있어요. 승인된 항목을 열어 원픽으로 선택해주세요.</Text>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => router.replace('/(tabs)/profile')}>
              <Text style={styles.primaryButtonText}>내 등록 요청 보기</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.homeButton} onPress={() => router.replace('/')}>
              <Text style={styles.retryText}>홈으로 돌아가기</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    if (appliedCategoryLabel) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <Text style={styles.kicker}>CATEGORY APPLIED</Text>
            <Text style={styles.stateTitle}>카테고리를 적용했어요</Text>
            <Text style={styles.requestedName}>{submittedItem.name}</Text>
            <Text style={styles.appliedCategory}>{appliedCategoryLabel}</Text>
            <Text style={styles.stateText}>최종 선택은 직접 적용되었습니다. 관리자 확인 후 승인된 제품을 원픽으로 선택할 수 있어요.</Text>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => router.replace('/(tabs)/profile')}>
              <Text style={styles.primaryButtonText}>내 등록 요청 보기</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.homeButton} onPress={() => router.replace('/')}>
              <Text style={styles.retryText}>홈으로 돌아가기</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    const suggestionIds = new Set(categorySuggestions.data?.suggestions.map((entry) => entry.categoryId) ?? []);
    const manualCategories = categorySuggestions.data?.categories.filter((entry) => !suggestionIds.has(entry.categoryId)) ?? [];
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.kicker}>AI CATEGORY SUGGESTION</Text>
          <Text style={styles.title}>AI가 카테고리를 추천해요</Text>
          <Text style={styles.requestedNameLeft}>{submittedItem.name}</Text>
          <Text style={styles.subtitle}>상품은 먼저 등록됐습니다. AI는 기존 카테고리 후보만 제안하며, 실제 적용은 직접 선택해야 합니다.</Text>

          {categorySuggestions.isPending ? (
            <View style={styles.suggestionState}><ActivityIndicator /><Text style={styles.helper}>상품명과 기존 카테고리를 비교하고 있어요</Text></View>
          ) : categorySuggestions.isError ? (
            <View style={styles.suggestionCard}>
              <Text style={styles.stateTitleSmall}>AI 추천을 불러오지 못했어요</Text>
              <Text style={styles.helper}>상품 등록은 유지됩니다. 다시 시도하거나 카테고리를 나중에 정할 수 있어요.</Text>
              <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void categorySuggestions.refetch()}>
                <Text style={styles.retryText}>AI 추천 다시 받기</Text>
              </Pressable>
            </View>
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
                <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => setShowAllCategories((value) => !value)}>
                  <Text style={styles.retryText}>{showAllCategories ? '직접 선택 닫기' : '다른 카테고리 직접 선택'}</Text>
                </Pressable>
              ) : null}

              {showAllCategories ? (
                <View style={styles.manualCategoryList}>
                  {manualCategories.map((option) => {
                    const selected = selectedSuggestedCategoryId === option.categoryId;
                    return (
                      <Pressable key={option.categoryId} accessibilityRole="radio"
                        accessibilityLabel={`${option.label} 직접 카테고리 선택`}
                        accessibilityState={{ selected, disabled: applyCategory.isPending }}
                        disabled={applyCategory.isPending}
                        onPress={() => setSelectedSuggestedCategoryId(option.categoryId)}
                        style={[styles.manualCategory, selected && styles.manualCategorySelected]}>
                        <Text style={[styles.manualCategoryText, selected && styles.suggestionLabelSelected]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {applyCategory.isError ? <Text style={styles.error}>카테고리를 적용하지 못했어요. 선택은 유지되니 다시 시도하거나 나중에 정할 수 있어요.</Text> : null}

              <Pressable accessibilityRole="button"
                disabled={!selectedSuggestedCategoryId || applyCategory.isPending}
                onPress={() => void applySelectedCategory()}
                style={[styles.primaryButton, (!selectedSuggestedCategoryId || applyCategory.isPending) && styles.disabled]}>
                {applyCategory.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>이 카테고리 적용</Text>}
              </Pressable>
            </View>
          ) : null}

          <Pressable accessibilityRole="button" style={styles.homeButton} onPress={() => router.replace('/(tabs)/profile')}>
            <Text style={styles.retryText}>카테고리는 나중에 정하기</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.homeButton} onPress={() => router.replace('/')}>
            <Text style={styles.retryText}>홈으로 돌아가기</Text>
          </Pressable>
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
        <Text style={styles.kicker}>새로운 원픽의 시작</Text>
        <Text style={styles.title}>제품 등록 요청</Text>
        <Text style={styles.subtitle}>검색에서 찾지 못한 상품명을 먼저 등록합니다. 일반 상품은 등록 뒤 AI가 기존 카테고리 후보를 제안하고, 최종 카테고리는 직접 선택합니다. 콘텐츠는 선택한 종류를 그대로 사용합니다.</Text>

        <Text style={styles.label}>제품명</Text>
        <TextInput
          accessibilityLabel="요청 제품명"
          editable={!submitting}
          maxLength={100}
          onChangeText={(value) => { setName(value); approvePhoto(false); }}
          placeholder="제품명"
          placeholderTextColor="#89909C"
          style={styles.input}
          value={name}
        />

        {categoryId ? <>
          <Text style={styles.label}>선택한 콘텐츠 종류</Text>
          {categories.isPending ? <ActivityIndicator /> : categories.isError ? (
            <View>
              <Text style={styles.error}>선택한 종류를 확인하지 못했어요. 입력한 내용은 그대로 있어요.</Text>
              <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void categories.refetch()}>
                <Text style={styles.retryText}>종류 다시 확인하기</Text>
              </Pressable>
            </View>
          ) : selectedCategory ? <Text style={styles.selectedCategory}>{selectedCategory.label ?? selectedCategory.name}</Text>
            : <Text style={styles.error}>선택한 콘텐츠 종류를 사용할 수 없어요. 검색 화면에서 다시 선택해주세요.</Text>}
        </> : <View style={styles.notice}>
          <Text style={styles.noticeText}>지금은 상품명만 등록하면 됩니다. 등록이 끝나면 AI가 몇 가지 카테고리를 제안하고, 원하는 카테고리를 직접 적용할 수 있어요.</Text>
        </View>}

        <View style={styles.photoCard}>
          <Text style={styles.photoTitle}>제품 대표 이미지 · 선택</Text>
          <Text style={styles.helper}>승인된 대표 사진 한 장을 같은 제품을 고른 사람들이 함께 사용해요.</Text>
          {auth.user ? <>
            <Pressable accessibilityRole="button" disabled={submitting} style={[styles.photoButton, submitting && styles.disabled]} onPress={() => void getPhoto(false)}>
              <Text style={styles.retryText}>{photo ? '사진 바꾸기' : '직접 사진 선택'}</Text>
            </Pressable>
            <Text style={styles.helper}>또는 제조사 제품·이미지 링크에서 가져올 수 있어요.</Text>
            <TextInput accessibilityLabel="제품 이미지 링크" editable={!submitting} value={imageLink} onChangeText={setImageLink}
              autoCapitalize="none" keyboardType="url" maxLength={2048} placeholder="https://…" style={[styles.input, styles.linkInput]} />
            <Pressable accessibilityRole="button" disabled={submitting || !imageLink.trim()} onPress={() => void getPhoto(true)} style={[styles.retryButton, (submitting || !imageLink.trim()) && styles.disabled]}>
              <Text style={styles.retryText}>링크에서 이미지 가져오기</Text>
            </Pressable>
          </> : <Pressable accessibilityRole="button" style={styles.photoButton} onPress={() => router.push({ pathname: '/auth/login', params: intent })}>
            <Text style={styles.retryText}>로그인하고 사진 추가</Text>
          </Pressable>}
          {photoPicker.isPending || imageImport.isPending ? <View style={styles.photoLoading}><ActivityIndicator /><Text style={styles.helper}>사진을 준비하고 있어요</Text></View> : null}
          {photoPicker.isError || imageImport.isError ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(photoPicker.error ?? imageImport.error)}</Text> : null}
          {photo ? <>
            <Image source={{ uri: photo.uri }} style={styles.photoPreview} resizeMode="contain" accessibilityLabel="제품 대표 이미지 미리보기" />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: photoApproved, disabled: submitting }} disabled={submitting}
              onPress={() => approvePhoto(!photoApproved)} style={styles.photoButton}>
              <Text style={styles.confirmText}>{photoApproved ? '☑' : '☐'} 이 제품의 사진이 맞으며 대표 이미지로 공유할 수 있어요</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={submitting} style={styles.retryButton} onPress={() => { setPhoto(null); approvePhoto(false); photoPicker.reset(); imageImport.reset(); registration.reset(); }}>
              <Text style={styles.retryText}>사진 제거</Text>
            </Pressable>
            {!photoApproved ? <Text style={styles.helper}>사진을 확인하고 위 항목에 체크해주세요.</Text> : null}
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
            <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void profile.refetch()}>
              <Text style={styles.retryText}>프로필 다시 불러오기</Text>
            </Pressable>
          </View>
        ) : null}

        {registration.isError ? <Text style={styles.error}>{errorMessage(registration.error)}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={[styles.primaryButton, !canSubmit && styles.disabled]}>
          {registration.isPending ? <ActivityIndicator color="#FFFFFF" /> : (
            <Text style={styles.primaryButtonText}>{auth.user ? '제품 등록 요청 보내기' : '로그인하고 요청하기'}</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 36 },
  center: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  backButton: { width: 44, minHeight: 44, justifyContent: 'center', marginLeft: -8, marginTop: 4, paddingLeft: 8 },
  back: { color: '#202124', fontSize: 36, lineHeight: 42 },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '700', marginTop: 16 },
  title: { color: '#202124', fontSize: 26, lineHeight: 34, fontWeight: '900', marginTop: 8 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 10 },
  label: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 25, marginBottom: 9 },
  input: { minHeight: 52, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 16, paddingHorizontal: 15, color: '#202124', fontSize: 15 },
  selectedCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', marginBottom: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', borderRadius: 999, backgroundColor: '#ECEEF3', paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: '#4945ED' },
  chipText: { color: '#5F6470', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#FFFFFF' },
  helper: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 10 },
  notice: { backgroundColor: '#ECEEF3', borderRadius: 14, padding: 13, marginTop: 18 },
  noticeText: { color: '#5F6470', fontSize: 12, lineHeight: 17 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 14 },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 12, paddingHorizontal: 4 },
  homeButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginTop: 8 },
  retryText: { color: '#4945ED', fontSize: 13, fontWeight: '800' },
  primaryButton: { minHeight: 52, borderRadius: 16, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 22 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  requestedName: { color: '#202124', fontSize: 18, fontWeight: '900', marginTop: 18, textAlign: 'center' },
  requestedNameLeft: { color: '#202124', fontSize: 19, fontWeight: '900', marginTop: 16 },
  appliedCategory: { color: '#4945ED', fontSize: 14, fontWeight: '900', marginTop: 12, textAlign: 'center' },
  stateTitle: { color: '#202124', fontSize: 21, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  stateTitleSmall: { color: '#202124', fontSize: 16, fontWeight: '900' },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  disabled: { opacity: 0.4 },
  photoCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 18, padding: 18, marginTop: 24 },
  photoTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  photoButton: { minHeight: 48, justifyContent: 'center', borderRadius: 12, backgroundColor: '#EFEEFF', padding: 14, marginTop: 14 },
  photoPreview: { width: '100%', height: 220, backgroundColor: '#F5F6F8', borderRadius: 14, marginTop: 12 },
  photoLoading: { alignItems: 'center', paddingVertical: 10 },
  confirmText: { color: '#4945ED', fontSize: 13, lineHeight: 20, fontWeight: '700' },
  suggestionState: { alignItems: 'center', paddingVertical: 28 },
  suggestionCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 18, padding: 18, marginTop: 22 },
  suggestionTitle: { color: '#202124', fontSize: 15, fontWeight: '900', marginBottom: 4 },
  suggestionOption: { borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 15, padding: 14, marginTop: 10 },
  suggestionOptionSelected: { borderColor: '#4945ED', backgroundColor: '#EFEEFF' },
  suggestionLabel: { color: '#202124', fontSize: 14, fontWeight: '800' },
  suggestionLabelSelected: { color: '#4945ED' },
  suggestionReason: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 5 },
  categoryGapNotice: { color: '#747985', backgroundColor: '#F5F6F8', borderRadius: 12, padding: 12, fontSize: 12, lineHeight: 18, marginTop: 13 },
  manualCategoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  manualCategory: { borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  manualCategorySelected: { borderColor: '#4945ED', backgroundColor: '#EFEEFF' },
  manualCategoryText: { color: '#5F6470', fontSize: 12, fontWeight: '700' },
  linkInput: { marginTop: 10 },
});
