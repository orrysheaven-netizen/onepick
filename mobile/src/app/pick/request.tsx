import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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

export default function RequestProductScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string; productName?: string }>();
  const auth = useAuthSession();
  const categories = useRegistrationCategories();
  const profile = useMyProfile(auth.user?.id);
  const registration = useRegisterPick();
  const [name, setName] = useState(typeof params.productName === 'string' ? params.productName : '');
  const [categoryId, setCategoryId] = useState(typeof params.categoryId === 'string' ? params.categoryId : '');
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  const selectedCategory = categories.data?.find((category) => category.id === categoryId);
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const isValid = normalizedName.length >= 1 && normalizedName.length <= 100 && Boolean(selectedCategory);
  const intent = useMemo(() => ({
    action: 'request_product' as const,
    productName: normalizedName,
    ...(categoryId ? { categoryId } : {}),
  }), [categoryId, normalizedName]);

  const submit = async () => {
    if (!auth.user) {
      router.push({ pathname: '/auth/login', params: intent });
      return;
    }
    if (!isValid || registration.isPending) return;

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
    }
  };

  if (auth.isLoading) {
    return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator /><Text style={styles.stateText}>로그인 상태를 확인하고 있어요</Text></View></SafeAreaView>;
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
          <Text style={styles.stateText}>관리자가 확인해 정식 제품으로 승인하면 원픽으로 선택할 수 있습니다.</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.replace('/')}>
            <Text style={styles.primaryButtonText}>홈으로 돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="돌아가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.kicker}>REQUEST PRODUCT</Text>
        <Text style={styles.title}>없는 제품만 요청해주세요</Text>
        <Text style={styles.subtitle}>검색했던 제품명은 그대로 넣어두었습니다. 제품명과 카테고리만 확인하면 됩니다.</Text>

        <Text style={styles.label}>제품명</Text>
        <TextInput
          accessibilityLabel="요청 제품명"
          maxLength={100}
          onChangeText={setName}
          placeholder="제품명"
          placeholderTextColor="#AAA39C"
          style={styles.input}
          value={name}
        />

        <Text style={styles.label}>카테고리</Text>
        {selectedCategory ? <Text style={styles.selectedCategory}>{selectedCategory.name}</Text> : null}
        {categories.isPending ? <ActivityIndicator /> : (
          <View style={styles.chips}>
            {categories.data?.map((category) => (
              <Pressable
                key={category.id}
                accessibilityRole="button"
                accessibilityState={{ selected: category.id === categoryId }}
                onPress={() => setCategoryId(category.id)}
                style={[styles.chip, category.id === categoryId && styles.chipActive]}>
                <Text style={[styles.chipText, category.id === categoryId && styles.chipTextActive]}>{category.name}</Text>
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

        {registration.isError ? <Text style={styles.error}>{errorMessage(registration.error)}</Text> : null}

        <Pressable
          disabled={!isValid || registration.isPending}
          onPress={() => void submit()}
          style={[styles.primaryButton, (!isValid || registration.isPending) && styles.disabled]}>
          {registration.isPending ? <ActivityIndicator color="#FFFFFF" /> : (
            <Text style={styles.primaryButtonText}>{auth.user ? '제품 등록 요청 보내기' : '로그인하고 요청하기'}</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 60 },
  center: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  back: { color: '#202124', fontSize: 36, lineHeight: 42, marginTop: 4 },
  kicker: { color: '#D96D4B', fontSize: 10, fontWeight: '900', letterSpacing: 2.1, marginTop: 18 },
  title: { color: '#202124', fontSize: 29, lineHeight: 36, fontWeight: '900', marginTop: 8 },
  subtitle: { color: '#827C77', fontSize: 13, lineHeight: 20, marginTop: 10 },
  label: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 25, marginBottom: 9 },
  input: { minHeight: 52, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1D9D2', borderRadius: 16, paddingHorizontal: 15, color: '#202124', fontSize: 15 },
  selectedCategory: { color: '#D96D4B', fontSize: 12, fontWeight: '800', marginBottom: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, backgroundColor: '#F0ECE7', paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: '#D96D4B' },
  chipText: { color: '#6C6863', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#FFFFFF' },
  helper: { color: '#8E8A85', fontSize: 11, lineHeight: 17, marginTop: 10 },
  notice: { backgroundColor: '#F2ECE7', borderRadius: 14, padding: 13, marginTop: 18 },
  noticeText: { color: '#6C6863', fontSize: 11, lineHeight: 17 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 18, marginTop: 14 },
  primaryButton: { minHeight: 52, borderRadius: 16, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 22 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  requestedName: { color: '#202124', fontSize: 18, fontWeight: '900', marginTop: 18, textAlign: 'center' },
  stateTitle: { color: '#202124', fontSize: 21, fontWeight: '900', marginTop: 10, textAlign: 'center' },
  stateText: { color: '#8E8A85', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  disabled: { opacity: 0.4 },
});