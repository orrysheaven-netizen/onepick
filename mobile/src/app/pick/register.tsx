import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PickPhoto } from '@/components/pick-photo';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useItemDetail } from '@/hooks/useItemDetail';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useChoosePhoto, useImportItemPhoto, useRegisterPick, useRegistrationCategories } from '@/hooks/useRegisterPick';
import { canonicalItemName, categoryRegistrationHint } from '@/lib/items/itemIdentity';
import { isPhotoFailure, showPhotoFailure } from '@/lib/photos/photoFailure';
import type { PickPhotoDraft } from '@/types/domain/photo';
import type { Item } from '@/types/domain/item';

function message(error: unknown) {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'PHOTO_INVALID': return '이미지를 읽지 못했어요. JPG·PNG 사진을 선택하거나 사진 없이 등록할 수 있어요.';
      case 'PHOTO_TOO_LARGE': return '사진 용량이 너무 커 자동 최적화할 수 없어요. 다른 사진을 선택해주세요.';
      case 'PHOTO_UPLOAD_FAILED': return '사진 파일은 정상적으로 읽었지만 서버 저장에 실패했어요. 다시 시도하거나 사진 없이 등록해주세요.';
      case 'IMAGE_SOURCE_UNSUPPORTED': return '지원하는 제조사 사이트의 HTTPS 상품·이미지 링크를 넣어주세요. 다른 링크는 직접 업로드를 이용해주세요.';
      case 'IMAGE_IMPORT_FAILED': return '이 링크에서 사진을 가져오지 못했어요. 이미지 직접 링크·직접 업로드를 이용하거나 사진 없이 등록해주세요.';
      case 'CATEGORY_NOT_PICKABLE': return '지금은 이 카테고리에 등록할 수 없어요.';
      case 'ITEM_NAME_INVALID': return '제품명과 세부 종류를 합쳐 1~100자로 입력해주세요.';
      case 'REVIEW_INVALID': return '한줄평을 1~100자로 입력해주세요.';
      case 'RATE_LIMITED': return '등록 요청이 많아요. 잠시 후 다시 시도해주세요.';
      case 'AUTH_REQUIRED': return '로그인 상태를 다시 확인해주세요.';
      case 'PROFILE_NOT_FOUND': return '사용자명을 먼저 정해주세요.';
    }
  }
  return '등록하지 못했어요. 입력한 내용은 그대로 있어요. 다시 시도해주세요.';
}

type Params = { categoryId?: string; itemId?: string; itemName?: string };
export default function RegisterPickScreen() {
  const auth = useAuthSession();
  const params = useLocalSearchParams<Params>();
  return <RegistrationForm key={`${auth.user?.id ?? 'anon'}:${params.categoryId ?? ''}:${params.itemId ?? ''}`} auth={auth} params={params} />;
}

function RegistrationForm({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const { user, isLoading, error: sessionError, retry } = auth;
  const categories = useRegistrationCategories();
  const profile = useMyProfile(user?.id);
  const prefill = useItemDetail(params.itemId, user?.id);
  const photoPicker = useChoosePhoto();
  const imageImport = useImportItemPhoto();
  const registration = useRegisterPick();
  const busy = useRef(false);
  const [submitted, setSubmitted] = useState<Item | null>(null);
  const [photo, setPhoto] = useState<PickPhotoDraft | null>(null);
  const [photoApproved, approvePhoto] = useState(false);
  const [imageLink, setImageLink] = useState('');
  const [chosenCategory, setCategory] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(params.itemName?.slice(0, 100) ?? null);
  const [selected, setSelected] = useState<Item | null | undefined>(undefined);
  const [custom, setCustom] = useState(Boolean(params.itemName));
  const [variantMode, setVariantMode] = useState<'none' | 'custom' | null>(null);
  const [variant, setVariant] = useState('');
  const [draftReview, setReview] = useState<string | null>(null);
  const categoryId = chosenCategory ?? params.categoryId ?? prefill.data?.item.categoryId ?? '';
  const category = categories.data?.find((item) => item.id === categoryId);
  const selectedItem = selected === undefined && !prefill.isError ? prefill.data?.item : selected;
  const itemName = name ?? selectedItem?.name ?? '';
  const fullName = selectedItem?.name ?? canonicalItemName([itemName, variantMode === 'custom' ? variant : ''].join(' '), category?.slug ?? '');
  const searchName = canonicalItemName(itemName, category?.slug ?? '');
  const search = useItemSearch(!selectedItem ? searchName : '', categoryId || undefined);
  const currentPick = profile.data?.currentPicks.find((item) => item.pick.categoryId === categoryId);
  const review = draftReview ?? (currentPick?.pick.itemId === selectedItem?.id ? currentPick?.pick.oneLineReview ?? '' : '');
  const nameConfirmed = Boolean(selectedItem || (custom && variantMode && (variantMode === 'none' || variant.trim())));
  const submitting = registration.isPending || photoPicker.isPending || imageImport.isPending;
  const sharedImage = selectedItem?.imageUrl ?? selectedItem?.thumbnailUrl ?? selectedItem?.imageSourceUrl;
  const hasSharedPhoto = Boolean(sharedImage || selectedItem?.imagePath);
  const ready = Boolean(category && !categories.isError && nameConfirmed && fullName.length > 0 && fullName.length <= 100
    && (!selectedItem || selectedItem.categoryId === categoryId) && (!selectedItem || (review.trim().length > 0 && review.trim().length <= 100))
    && (!photo || hasSharedPhoto || photoApproved) && !submitting && profile.data && !profile.isError);
  const intent = { action: 'register_pick', ...(categoryId ? { categoryId } : {}), ...(selectedItem ? { itemId: selectedItem.id } : {}) };

  const changeName = (value: string) => { setName(value); setSelected(null); setCustom(false); setVariantMode(null); setVariant(''); approvePhoto(false); registration.reset(); };
  const getPhoto = async (fromLink: boolean) => {
    if (busy.current || submitting) return;
    busy.current = true;
    try {
      const result = fromLink ? await imageImport.mutateAsync(imageLink) : await photoPicker.mutateAsync();
      if (result) { setPhoto(result); approvePhoto(false); }
    } catch (error) {
      showPhotoFailure(error, fromLink ? 'register_pick_photo_import' : 'register_pick_photo_choose');
      /* Keep any previous image and render an actionable error. */
    }
    finally { busy.current = false; }
  };
  const submit = async () => {
    if (!ready || !user || busy.current) return;
    busy.current = true;
    try {
      const result = await registration.mutateAsync({ userId: user.id, categoryId, itemId: selectedItem?.id,
        itemName: selectedItem?.name ?? itemName, variant: selectedItem || variantMode === 'none' ? '' : variant,
        oneLineReview: review, photo: hasSharedPhoto ? null : photo });
      if (result.type === 'pick') router.replace({ pathname: '/pick/[pickId]', params: { pickId: result.pick.id } });
      else setSubmitted(result.item);
    } catch (error) {
      if (photo && !hasSharedPhoto && isPhotoFailure(error)) showPhotoFailure(error, 'register_pick_photo_upload');
      /* Keep the whole draft for retry. */
    }
    finally { busy.current = false; }
  };

  if (submitted) return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}><View style={styles.content}>
    <Text style={styles.title}>{submitted.status === 'pending' ? '제품 등록을 요청했어요' : '이미 등록된 제품이에요'}</Text>
    <Text style={styles.subtitle}>{submitted.name}</Text>
    <Text style={styles.notice}>{submitted.status === 'pending' ? '관리자가 확인한 뒤 정식 제품으로 등록해요. 승인 후 내 프로필의 제품 등록 요청에서 원픽으로 선택할 수 있어요.' : '이 제품을 선택하고 나만의 한줄평을 남겨주세요.'}</Text>
    <Pressable style={styles.primary} onPress={() => submitted.status === 'pending' ? router.replace('/(tabs)/profile') : router.replace({ pathname: '/pick/register', params: { itemId: submitted.id } })}><Text style={styles.primaryText}>{submitted.status === 'pending' ? '내 프로필로' : '이 제품으로 원픽 등록'}</Text></Pressable>
  </View></SafeAreaView>;

  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" disabled={submitting} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Text style={styles.back}>‹</Text></Pressable>
      <Text style={styles.kicker}>YOUR ONE PICK</Text>
      <Text style={styles.title}>나의 원픽 등록</Text>
      <Text style={styles.subtitle}>좋아하는 제품의 이름을 적고 나만의 이유를 남겨보세요.</Text>
      {isLoading ? <ActivityIndicator /> : sessionError ? <View style={styles.card}><Text>로그인 상태를 확인하지 못했어요.</Text><Pressable onPress={retry}><Text style={styles.link}>다시 확인하기</Text></Pressable></View> : !user ?
        <View style={styles.card}><Text>원픽을 등록하려면 로그인해주세요.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth/login', params: intent })}><Text style={styles.primaryText}>로그인하고 등록하기</Text></Pressable></View>
        : profile.error instanceof AppError && profile.error.code === 'PROFILE_NOT_FOUND' ?
          <View style={styles.card}><Text>원픽에 표시할 사용자명을 먼저 정해주세요.</Text><Pressable style={styles.primary} onPress={() => router.push({ pathname: '/auth/username', params: intent })}><Text style={styles.primaryText}>사용자명 만들기</Text></Pressable></View>
          : <>
            <Text style={styles.label}>제품명과 세부 종류</Text>
            <TextInput accessibilityLabel="제품명" editable={!submitting} style={styles.input} placeholder={category?.slug === 'ramen' ? '예: 진라면' : '브랜드와 제품 이름을 입력해주세요'} maxLength={100} value={itemName} onChangeText={changeName} />
            <Text style={styles.hint}>같은 제품이 있으면 아래 이름을 선택해주세요. 없는 제품은 관리자에게 등록을 요청할 수 있어요.</Text>
            {params.itemId && prefill.isError && name === null ? <Text style={styles.error}>제품 정보를 불러오지 못했어요. 이름을 입력해 다시 찾아주세요.</Text> : null}
            {selectedItem ? <View style={styles.confirmed}><Text style={styles.confirmedText}>✓ {selectedItem.name}</Text><Text style={styles.hint}>{category ? `${category.label ?? category.name} · 카테고리가 자동으로 선택됐어요.` : '현재 선택할 수 없는 카테고리예요.'}</Text></View> : itemName.trim() ? <>
              {search.isWaiting || search.isFetching ? <ActivityIndicator /> : null}
              {search.isError ? <Pressable onPress={() => void search.refetch()}><Text style={styles.error}>이름 후보를 불러오지 못했어요. 다시 불러오기</Text></Pressable> : null}
              {!search.isWaiting && search.data?.map((item) => <Pressable key={item.id} accessibilityRole="button" disabled={submitting} style={styles.option} onPress={() => { setCategory(item.categoryId); setSelected(item); setName(item.name); setCustom(false); setPhoto(null); }}><Text style={styles.optionText}>{item.name}</Text><Text style={styles.link}>이 제품 선택 ›</Text></Pressable>)}
              <Pressable accessibilityRole="button" accessibilityState={{ selected: custom }} disabled={submitting} style={[styles.option, custom && styles.confirmed]} onPress={() => setCustom(true)}><Text style={styles.optionText}>{custom ? '✓ ' : '＋ '}목록에 없어요 — 제품 등록 요청</Text></Pressable>
              {custom ? <>
            <Text style={styles.label}>카테고리</Text>
            {categories.isPending ? <ActivityIndicator /> : categories.isError ? <Pressable onPress={() => void categories.refetch()}><Text style={styles.error}>카테고리를 불러오지 못했어요. 다시 불러오기</Text></Pressable> : <View style={styles.choices}>
              {categories.data?.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: categoryId === item.id }} disabled={submitting} style={[styles.chip, categoryId === item.id && styles.chosen]} onPress={() => { setCategory(item.id); approvePhoto(false); registration.reset(); }}><Text style={categoryId === item.id ? styles.chosenText : styles.chipText}>{item.label ?? item.name}</Text></Pressable>)}
            </View>}
            {category ? <Text style={styles.hint}>{categoryRegistrationHint(category.slug)}</Text> : !categories.isPending ? <Text style={styles.error}>등록 가능한 카테고리를 선택해주세요.</Text> : null}


                <Text style={styles.smallLabel}>맛·제품 종류를 구분할까요?</Text>
                <View style={styles.choices}>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: variantMode === 'none' }} disabled={submitting} onPress={() => { setVariantMode('none'); approvePhoto(false); }} style={[styles.chip, variantMode === 'none' && styles.chosen]}><Text style={variantMode === 'none' ? styles.chosenText : styles.chipText}>입력한 이름으로 요청</Text></Pressable>
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: variantMode === 'custom' }} disabled={submitting} onPress={() => { setVariantMode('custom'); approvePhoto(false); }} style={[styles.chip, variantMode === 'custom' && styles.chosen]}><Text style={variantMode === 'custom' ? styles.chosenText : styles.chipText}>맛·제품 종류 추가</Text></Pressable>
                </View>
                {variantMode === 'custom' ? <TextInput accessibilityLabel="세부 종류" editable={!submitting} style={styles.input} placeholder="예: 매운맛, 순한맛, 무알코올" value={variant} maxLength={60} onChangeText={(value) => { setVariant(value); approvePhoto(false); }} /> : null}
              </> : null}
            </> : null}
            {nameConfirmed ? <Text style={styles.summary}>{selectedItem ? '선택 제품' : '요청 제품명'}: {fullName}</Text> : null}

            {nameConfirmed ? <>
              <Text style={styles.label}>제품 대표 이미지 · 선택</Text>
              {hasSharedPhoto ? <><PickPhoto uri={sharedImage} label={selectedItem?.name ?? fullName} large /><Text style={styles.hint}>이미 등록된 대표 이미지를 사용해요. 새 사진을 올리지 않아도 됩니다.</Text></> : <>
                <Text style={styles.hint}>제품 링크에서 사진을 가져오거나 직접 올릴 수 있어요. 사진 없이 등록해도 괜찮아요.</Text>
                <Text style={styles.hint}>상품 이름이 잘 보이는 사진이면 충분해요. 채택된 사진은 함께 사용하고, 상품 상세에 사진 등록자로 내 사용자명과 프로필 링크가 표시돼요.</Text>
                <TextInput accessibilityLabel="제품 이미지 링크" editable={!submitting} autoCapitalize="none" keyboardType="url" style={styles.input} value={imageLink} onChangeText={setImageLink} placeholder="https://…" maxLength={2048} />
                <Pressable accessibilityRole="button" disabled={submitting || !imageLink.trim()} onPress={() => void getPhoto(true)} style={[styles.option, (submitting || !imageLink.trim()) && styles.disabled]}><Text style={styles.optionText}>링크에서 이미지 가져오기</Text></Pressable>
                <Text style={styles.hint}>농심·오뚜기·하이트진로·오비맥주·오리온·롯데웰푸드 공식 사이트의 상품 또는 JPG·PNG 이미지 링크를 지원해요. 사이트에 따라 가져오지 못할 수 있어요.</Text>
                <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void getPhoto(false)} style={styles.option}><Text style={styles.optionText}>직접 사진 선택</Text></Pressable>
                {imageImport.isPending || photoPicker.isPending ? <ActivityIndicator /> : null}
                {imageImport.isError ? <Text accessibilityRole="alert" style={styles.error}>{message(imageImport.error)}</Text> : null}
                {photoPicker.isError ? <Text accessibilityRole="alert" style={styles.error}>{message(photoPicker.error)}</Text> : null}
                {photo ? <>
                  <View style={styles.photo}><Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" accessibilityLabel="가져온 대표 이미지 미리보기" /></View>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: photoApproved }} disabled={submitting} onPress={() => approvePhoto(!photoApproved)} style={styles.option}><Text style={styles.optionText}>{photoApproved ? '☑' : '☐'} 이 제품의 사진이 맞으며 대표 이미지로 공유할 수 있어요</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={submitting} onPress={() => { setPhoto(null); approvePhoto(false); registration.reset(); }}><Text style={styles.link}>사진 없이 진행하기</Text></Pressable>
                </> : null}
                <Text style={styles.hint}>사용 권한이 있는 사진을 선택해주세요. 승인된 제품의 대표 이미지는 같은 제품을 고른 사람들이 함께 사용합니다.</Text>
              </>}
            </> : null}

            {selectedItem ? <>
            <Text style={styles.label}>한줄평</Text>
            <TextInput accessibilityLabel="원픽 한줄평" editable={!submitting} style={[styles.input, styles.review]} multiline maxLength={100} placeholder="왜 이 제품이 나의 원픽인가요?" value={review} onChangeText={setReview} />
            <Text style={styles.hint}>{review.length}/100 · 한줄평은 필수예요.</Text>
            {currentPick ? <Text style={styles.notice}>현재 원픽: {currentPick.item?.name ?? '등록된 제품'}. 같은 제품이면 한줄평을 갱신하고, 다른 제품이면 이전 원픽을 기록으로 남깁니다.</Text> : null}
            </> : custom ? <Text style={styles.notice}>관리자 승인 후 원픽으로 선택할 수 있어요. 지금의 원픽은 유지됩니다.</Text> : null}
            {categories.isError ? <Pressable onPress={() => void categories.refetch()}><Text style={styles.error}>카테고리를 다시 불러오기</Text></Pressable> : null}
            {profile.isPending ? <ActivityIndicator /> : profile.isError ? <Pressable onPress={() => void profile.refetch()}><Text style={styles.error}>내 원픽 정보를 확인하지 못했어요. 다시 확인하기</Text></Pressable> : null}
            {registration.isError ? <Text accessibilityRole="alert" style={styles.error}>{message(registration.error)}</Text> : null}
            <Pressable accessibilityRole="button" disabled={!ready} onPress={() => void submit()} style={[styles.primary, !ready && styles.disabled]}>{registration.isPending ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>{selectedItem ? '원픽 등록하기' : '제품 등록 요청하기'}</Text>}</Pressable>
          </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 22, paddingBottom: 60 },
  back: { fontSize: 36, color: '#202124', marginBottom: 14 },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  title: { fontSize: 30, fontWeight: '800', color: '#202124', marginTop: 10 },
  subtitle: { fontSize: 14, lineHeight: 22, color: '#747985', marginTop: 10, marginBottom: 8 },
  label: { fontSize: 18, fontWeight: '800', color: '#202124', marginTop: 28, marginBottom: 12 },
  smallLabel: { fontSize: 14, fontWeight: '700', color: '#202124', marginTop: 18, marginBottom: 10 },
  photo: { height: 230, backgroundColor: '#F8F9FB', borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  preview: { width: '100%', height: '100%' },
  plus: { fontSize: 38, color: '#4945ED' },
  photoText: { fontSize: 15, fontWeight: '700', color: '#6B625B', marginTop: 8 },
  hint: { fontSize: 12, lineHeight: 19, color: '#747985', marginTop: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { padding: 12, borderRadius: 20, backgroundColor: 'white', borderWidth: 1, borderColor: '#DDD5CD' },
  chipText: { color: '#625A53', fontWeight: '600' },
  chosen: { backgroundColor: '#4945ED', borderColor: '#4945ED' },
  chosenText: { color: 'white', fontWeight: '700' },
  input: { backgroundColor: 'white', borderWidth: 1, borderColor: '#DDD5CD', borderRadius: 14, padding: 16, fontSize: 16, color: '#202124' },
  review: { minHeight: 110, textAlignVertical: 'top' },
  option: { padding: 16, backgroundColor: 'white', borderRadius: 14, marginTop: 8 },
  optionText: { color: '#202124', fontSize: 15, fontWeight: '700' },
  link: { color: '#4945ED', fontSize: 13, fontWeight: '700', marginTop: 8 },
  confirmed: { padding: 16, backgroundColor: '#F7E7DD', borderRadius: 14, marginTop: 10 },
  confirmedText: { color: '#A9482D', fontSize: 16, fontWeight: '800' },
  summary: { color: '#A9482D', fontSize: 15, fontWeight: '700', marginTop: 15 },
  notice: { fontSize: 12, lineHeight: 20, color: '#6B625B', backgroundColor: '#F8F9FB', padding: 14, borderRadius: 12, marginTop: 18 },
  error: { color: '#A9482D', fontSize: 13, lineHeight: 20, marginTop: 12 },
  primary: { backgroundColor: '#4945ED', padding: 18, alignItems: 'center', borderRadius: 16, marginTop: 22 },
  primaryText: { color: 'white', fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  card: { backgroundColor: 'white', padding: 24, borderRadius: 20, marginTop: 25 },
});
