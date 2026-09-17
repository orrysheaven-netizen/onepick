import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useRegisterPick, useRegistrationCategories } from '@/hooks/useRegisterPick';

function errorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'CATEGORY_NOT_PICKABLE') return '현재 등록 요청을 받을 수 없는 카테고리예요.';
    if (error.code === 'PRODUCT_NAME_INVALID') return '제품명은 1~100자로 입력해주세요.';
    if (error.code === 'RATE_LIMITED') return '등록 요청이 많아요. 잠시 후 다시 시도해주세요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '사용자명을 먼저 정해주세요.';
  }
  return '제품 등록 요청을 보내지 못했어요. 다시 시도해주세요.';
}

type Params = { categoryId?: string; productName?: string };

export default function RequestProductScreen() {
  const params = useLocalSearchParams<Params>();
  const auth = useAuthSession();
  return <RequestProductForm key={JSON.stringify([auth.user?.id ?? 'anon', params.categoryId, params.productName])} auth={auth} params={params} />;
}

function RequestProductForm({ auth, params }: { auth: ReturnType<typeof useAuthSession>; params: Params }) {
  const router = useRouter();
  const categories = useRegistrationCategories();
  const profile = useMyProfile(auth.user?.id);
  const registration = useRegisterPick();
  const busy = useRef(false);
  const [name, setName] = useState(typeof params.productName === 'string' ? params.productName : '');
  const [categoryId, setCategoryId] = useState(typeof params.categoryId === 'string' ? params.categoryId : '');
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  const selectedCategory = categories.data?.find((category) => category.id === categoryId);
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const isValid = normalizedName.length >= 1 && normalizedName.length <= 100 && Boolean(selectedCategory);
  const canSubmit = isValid && !categories.isPending && !categories.isError && !auth.isLoading && !auth.error
    && !registration.isPending && (!auth.user || Boolean(profile.data && !profile.isPending && !profile.isError));
  const intent = useMemo(() => ({
    action: 'request_product' as const,
    productName: normalizedName,
    ...(categoryId ? { categoryId } : {}),
  }), [categoryId, normalizedName]);

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
        productName: normalizedName,
        variant: '',
        oneLineReview: '',
        photo: null,
      });

      if (result.type === 'pending_product') {
        setSubmittedName(result.product.name);
        return;
      }

      if (result.type === 'existing_product') {
        router.replace({
          pathname: '/pick/choose',
          params: { productId: result.product.id, categoryId: result.product.categoryId },
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" disabled={registration.isPending} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.kicker}>REQUEST PRODUCT</Text>
        <Text style={styles.title}>없는 제품만 요청해주세요</Text>
        <Text style={styles.subtitle}>검색했던 제품명은 그대로 넣어두었습니다. 제품명과 카테고리만 확인하면 됩니다.</Text>

        <Text style={styles.label}>제품명</Text>
        <TextInput
          accessibilityLabel="요청 제품명"
          editable={!registration.isPending}
          maxLength={100}
          onChangeText={setName}
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
                accessibilityState={{ selected: category.id === categoryId, disabled: registration.isPending }}
                disabled={registration.isPending}
                onPress={() => setCategoryId(category.id)}
                style={[styles.chip, category.id === categoryId && styles.chipActive]}>
                <Text style={[styles.chipText, category.id === categoryId && styles.chipTextActive]}>{category.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.helper}>기존 정식 제품은 제품을 선택할 때 카테고리가 자동 연결됩니다. 이 단계는 미등록 제품 요청에만 필요합니다.</Text>

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
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 60 },
  center: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  back: { color: '#202124', fontSize: 36, lineHeight: 42, marginTop: 4 },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 2.1, marginTop: 18 },
  title: { color: '#202124', fontSize: 29, lineHeight: 36, fontWeight: '900', marginTop: 8 },
  subtitle: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 10 },
  label: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 25, marginBottom: 9 },
  input: { minHeight: 52, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 16, paddingHorizontal: 15, color: '#202124', fontSize: 15 },
  selectedCategory: { color: '#4945ED', fontSize: 12, fontWeight: '800', marginBottom: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, backgroundColor: '#ECEEF3', paddingHorizontal: 14, paddingVertical: 10 },
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
});
