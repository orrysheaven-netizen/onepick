import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useChoosePick } from '@/hooks/useChoosePick';
import { useProductDetail } from '@/hooks/useProductDetail';

function getErrorMessage(error: unknown) {
  if (!(error instanceof AppError)) {
    return '원픽을 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
  }

  switch (error.code) {
    case 'AUTH_REQUIRED':
      return '원픽을 고르려면 로그인이 필요해요.';
    case 'CATEGORY_NOT_PICKABLE':
      return '지금은 이 카테고리에서 원픽을 고를 수 없어요.';
    case 'PRODUCT_NOT_ELIGIBLE':
    case 'PRODUCT_NOT_FOUND':
      return '지금은 이 제품을 원픽으로 고를 수 없어요.';
    case 'PRODUCT_CATEGORY_MISMATCH':
      return '제품과 카테고리 정보가 맞지 않아요.';
    case 'REVIEW_INVALID':
      return '한줄평을 1~100자로 입력해주세요.';
    case 'PICK_CONFLICT':
      return '원픽 상태가 바뀌었어요. 다시 시도해주세요.';
    default:
      return '원픽을 저장하지 못했어요. 잠시 후 다시 시도해주세요.';
  }
}

export default function ChoosePickScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ productId?: string; categoryId?: string }>();
  const { user, isLoading: isSessionLoading } = useAuthSession();
  const productQuery = useProductDetail(params.productId, user?.id);
  const choosePick = useChoosePick();
  const [review, setReview] = useState('');
  const [savedReview, setSavedReview] = useState('');

  const product = productQuery.data?.product;
  const pickStatus = productQuery.data?.myPickStatus;
  const trimmedReview = review.trim();
  const isValidReview = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const routeMatchesProduct = !product || !params.categoryId || product.categoryId === params.categoryId;

  const submitLabel = useMemo(() => {
    if (pickStatus?.type === 'selected_other') return '이 제품으로 바꾸기';
    if (pickStatus?.type === 'selected_this') return '한줄평 저장';
    return '내 원픽으로 선택';
  }, [pickStatus]);

  const handleSubmit = async () => {
    if (!user || !product || !isValidReview || choosePick.isPending) return;

    const result = await choosePick.mutateAsync({
      categoryId: product.categoryId,
      productId: product.id,
      oneLineReview: trimmedReview,
    });

    setSavedReview(result.oneLineReview);
  };

  const isLoading = isSessionLoading || productQuery.isPending;
  const isSuccess = Boolean(savedReview);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        {isLoading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator />
            <Text style={styles.stateTitle}>제품을 확인하고 있어요</Text>
          </View>
        ) : null}

        {!isLoading && (productQuery.isError || !product || !routeMatchesProduct) ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>제품을 불러오지 못했어요</Text>
            <Text style={styles.stateText}>제품 정보가 바뀌었거나 사용할 수 없는 링크예요.</Text>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>돌아가기</Text>
            </Pressable>
          </View>
        ) : null}

        {!isLoading && product && routeMatchesProduct && !user ? (
          <View style={styles.stateCard}>
            <View style={styles.productIcon}><Text style={styles.productEmoji}>🍜</Text></View>
            <Text style={styles.kicker}>원픽을 고르려면</Text>
            <Text style={styles.title}>로그인이 필요해요</Text>
            <Text style={styles.stateText}>
              선택한 제품은 그대로 기억해두고 로그인 뒤 이 화면으로 돌아오도록 다음 단계에서 연결합니다.
            </Text>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>홈으로 돌아가기</Text>
            </Pressable>
          </View>
        ) : null}

        {!isLoading && product && routeMatchesProduct && user && !isSuccess ? (
          <>
            <Text style={styles.kicker}>YOUR ONE PICK</Text>
            <Text style={styles.title}>{product.name}</Text>
            <Text style={styles.subtitle}>왜 이 제품이 지금 당신의 원픽인가요?</Text>

            <View style={styles.productCard}>
              <View style={styles.productIcon}><Text style={styles.productEmoji}>🍜</Text></View>
              <View style={styles.productCopy}>
                <Text style={styles.productLabel}>선택한 제품</Text>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productState}>
                  {pickStatus?.type === 'selected_other'
                    ? '현재 원픽을 이 제품으로 변경합니다.'
                    : pickStatus?.type === 'selected_this'
                      ? '현재 원픽의 한줄평을 수정합니다.'
                      : '이 제품을 새 원픽으로 선택합니다.'}
                </Text>
              </View>
            </View>

            <View style={styles.inputHeader}>
              <Text style={styles.inputLabel}>한줄평</Text>
              <Text style={styles.counter}>{review.length}/100</Text>
            </View>
            <TextInput
              accessibilityLabel="원픽 한줄평"
              maxLength={100}
              multiline
              onChangeText={setReview}
              placeholder="예: 결국 기본으로 돌아오게 되는 맛"
              placeholderTextColor="#AAA39C"
              style={styles.reviewInput}
              value={review}
            />
            <Text style={styles.helperText}>짧아도 괜찮아요. 한줄평은 필수입니다.</Text>

            {choosePick.isError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{getErrorMessage(choosePick.error)}</Text>
              </View>
            ) : null}

            <Pressable
              disabled={!isValidReview || choosePick.isPending}
              onPress={() => void handleSubmit()}
              style={({ pressed }) => [
                styles.primaryButton,
                (!isValidReview || choosePick.isPending) && styles.primaryButtonDisabled,
                pressed && isValidReview && !choosePick.isPending && styles.pressed,
              ]}>
              {choosePick.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{submitLabel}</Text>}
            </Pressable>
          </>
        ) : null}

        {!isLoading && product && user && isSuccess ? (
          <View style={styles.successCard}>
            <View style={styles.successIcon}><Text style={styles.successIconText}>1</Text></View>
            <Text style={styles.kicker}>ONE PICK SAVED</Text>
            <Text style={styles.title}>원픽이 선택됐어요</Text>
            <Text style={styles.successProduct}>{product.name}</Text>
            <Text style={styles.savedReview}>“{savedReview}”</Text>
            <Pressable onPress={() => router.replace('/')} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>홈에서 확인하기</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  kicker: { color: '#D96D4B', fontSize: 11, fontWeight: '800', letterSpacing: 2.2, marginTop: 20 },
  title: { color: '#202124', fontSize: 30, lineHeight: 37, fontWeight: '800', letterSpacing: -0.8, marginTop: 9 },
  subtitle: { color: '#8E8A85', fontSize: 14, lineHeight: 21, marginTop: 10 },
  productCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 14, marginTop: 26 },
  productIcon: { width: 86, height: 86, borderRadius: 18, backgroundColor: '#F4D7C5', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 42 },
  productCopy: { flex: 1, paddingLeft: 16 },
  productLabel: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  productName: { color: '#202124', fontSize: 19, fontWeight: '800', marginTop: 6 },
  productState: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 7 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 28, marginBottom: 10 },
  inputLabel: { color: '#202124', fontSize: 15, fontWeight: '800' },
  counter: { color: '#8E8A85', fontSize: 11 },
  reviewInput: { minHeight: 126, borderRadius: 18, backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 15, color: '#202124', fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  helperText: { color: '#8E8A85', fontSize: 11, marginTop: 8 },
  primaryButton: { minHeight: 54, borderRadius: 17, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 24 },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 20 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  stateCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 26, marginTop: 34 },
  stateTitle: { color: '#202124', fontSize: 19, fontWeight: '800', marginTop: 14 },
  stateText: { color: '#8E8A85', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  errorBox: { backgroundColor: '#FFF0EB', borderRadius: 14, padding: 13, marginTop: 14 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18 },
  successCard: { alignItems: 'center', paddingTop: 58 },
  successIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#F9E4DB', alignItems: 'center', justifyContent: 'center' },
  successIconText: { color: '#D96D4B', fontSize: 34, fontWeight: '900' },
  successProduct: { color: '#202124', fontSize: 18, fontWeight: '800', marginTop: 24 },
  savedReview: { color: '#6C6863', fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 11, paddingHorizontal: 18 },
  pressed: { opacity: 0.7 },
});
