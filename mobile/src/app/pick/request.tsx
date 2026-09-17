import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useChoosePhoto, useImportItemPhoto, useRegisterPick, useRegistrationCategories } from '@/hooks/useRegisterPick';
import type { PickPhotoDraft } from '@/types/domain/photo';

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'PHOTO_INVALID') return '사진을 읽지 못했어요. JPG·PNG 사진을 다시 선택해주세요.';
    if (error.code === 'PHOTO_TOO_LARGE') return '사진이 너무 커요. 더 작은 사진을 선택해주세요.';
    if (error.code === 'PHOTO_UPLOAD_FAILED') return '사진을 저장하지 못했어요. 선택한 사진은 유지됩니다. 다시 시도해주세요.';
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
  const [categoryId, setCategoryId] = useState(typeof params.categoryId === 'string' ? params.categoryId : '');
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [photoApproved, approvePhoto] = useState(false);
  const [imageLink, setImageLink] = useState('');
  const submitting = registration.isPending || photoPicker.isPending || imageImport.isPending;

  const selectedCategory = categories.data?.find((category) => category.id === categoryId);
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const isValid = normalizedName.length >= 1 && normalizedName.length <= 100 && Boolean(selectedCategory);
  const canSubmit = isValid && !categories.isPending && !categories.isError && !auth.isLoading && !auth.error
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
        categoryId,
        itemName: normalizedName,
        variant: '',
        oneLineReview: '',
        photo,
      });

      if (result.type === 'pending_item') {
        setSubmittedName(result.item.name);
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

  if (submittedName) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.kicker}>REQUEST SENT</Text>
          <Text style={styles.stateTitle}>제품 등록 요청을 보냈어요</Text>
          <Text style={styles.requestedName}>{submittedName}</Text>
          <Text style={styles.stateText}>내 프로필에서 승인 상태를 확인할 수 있어요. 승인된 제품을 열어 원픽으로 선택해주세요.</Text>
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" disabled={submitting} style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.kicker}>새로운 원픽의 시작</Text>
        <Text style={styles.title}>제품 등록 요청</Text>
        <Text style={styles.subtitle}>제품명과 카테고리를 확인하고, 제품을 알아볼 수 있는 대표 사진을 함께 보내주세요. 사진 없이도 요청할 수 있어요.</Text>

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

        <Text style={styles.label}>카테고리</Text>
        {selectedCategory ? <Text style={styles.selectedCategory}>{selectedCategory.label}</Text> : null}
        {categories.isPending ? <ActivityIndicator /> : categories.isError ? (
          <View>
            <Text style={styles.error}>카테고리를 불러오지 못했어요. 입력한 내용은 그대로 있어요.</Text>
            <Pressable accessibilityRole="button" style={styles.retryButton} onPress={() => void categories.refetch()}>
              <Text style={styles.retryText}>카테고리 다시 불러오기</Text>
            </Pressable>
          </View>
        ) : !categories.data?.length ? (
          <Text style={styles.helper}>지금은 요청할 수 있는 카테고리가 없어요. 나중에 다시 확인해주세요.</Text>
        ) : (
          <View style={styles.chips}>
            {categories.data?.map((category) => (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityState={{ selected: category.id === categoryId, disabled: submitting }}
                disabled={submitting}
                onPress={() => { setCategoryId(category.id); approvePhoto(false); }}
                style={[styles.chip, category.id === categoryId && styles.chipActive]}>
                <Text style={[styles.chipText, category.id === categoryId && styles.chipTextActive]}>{category.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.helper}>기존 정식 제품은 제품을 선택할 때 카테고리가 자동 연결됩니다. 이 단계는 미등록 제품 요청에만 필요합니다.</Text>

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
  stateTitle: { color: '#202124', fontSize: 21, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  disabled: { opacity: 0.4 },
  photoCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 18, padding: 18, marginTop: 24 },
  photoTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  photoButton: { minHeight: 48, justifyContent: 'center', borderRadius: 12, backgroundColor: '#EFEEFF', padding: 14, marginTop: 14 },
  photoPreview: { width: '100%', height: 220, backgroundColor: '#F5F6F8', borderRadius: 14, marginTop: 12 },
  photoLoading: { alignItems: 'center', paddingVertical: 10 },
  confirmText: { color: '#4945ED', fontSize: 13, lineHeight: 20, fontWeight: '700' },
  linkInput: { marginTop: 10 },
});
