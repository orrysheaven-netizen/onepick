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
  const [draftReview, setReview] = useState<string | null>(null);
  const [savedReview, setSavedReview] = useState('');

  const product = productQuery.data?.product;
  const pickStatus = productQuery.data?.myPickStatus;
  const review = draftReview ?? (pickStatus?.type === 'selected_this' ? pickStatus.oneLineReview : '');
  const canChoose = productQuery.data?.canChoose ?? false;
  const trimmedReview = review.trim();
  const isValidReview = trimmedReview.length >= 1 && trimmedReview.length <= 100;
  const routeMatchesProduct = !product || !params.categoryId || product.categoryId === params.categoryId;

  const submitLabel = useMemo(() => {
    if (pickStatus?.type === 'selected_other') return '이 제품으로 바꾸기';
    if (pickStatus?.type === 'selected_this') return '한줄평 저장';
    return '내 원픽으로 선택';
  }, [pickStatus]);

  const handleSubmit = async () => {
    if (!user || !product || !canChoose || productQuery.isError || !routeMatchesProduct || !isValidReview || choosePick.isPending) return;

    try {
      const result = await choosePick.mutateAsync({
        categoryId: product.categoryId,
        productId: product.id,
        oneLineReview: trimmedReview,
      });

      setSavedReview(result.oneLineReview);
    } catch {
      // Mutation state renders the error.
    }
  };

  const openLogin = () => {
    if (!product) return;

    router.push({
      pathname: '/auth/login',
      params: {
        action: 'choose_pick',
        productId: product.id,
        categoryId: product.categoryId,
      },
    });
  };

  const isLoading = isSessionLoading || (Boolean(params.productId) && productQuery.isPending);
  const hasProduct = !isLoading && !productQuery.isError && Boolean(product) && routeMatchesProduct;
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

        {hasProduct && product && !canChoose && !isSuccess ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>지금은 선택할 수 없어요</Text>
            <Text style={styles.stateText}>현재 이 제품이나 카테고리에서는 새 원픽을 선택할 수 없어요.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace(pickStatus?.type === 'selected_this'
                ? { pathname: '/pick/[pickId]', params: { pickId: pickStatus.pickId } }
                : { pathname: '/product/[productId]', params: { productId: product.id } })}
              style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{pickStatus?.type === 'selected_this' ? '내 원픽 보기/수정' : '제품 상세 보기'}</Text>
            </Pressable>
          </View>
        ) : null}

        {hasProduct && product && canChoose && !user ? (
          <View style={styles.stateCard}>
            <View style={styles.productIcon}><Text style={styles.productEmoji}>🍜</Text></View>
            <Text style={styles.kicker}>원픽을 고르려면</Text>
            <Text style={styles.title}>로그인이 필요해요</Text>
            <Text style={styles.stateText}>
              선택한 제품을 기억해두고 로그인 뒤 이 화면으로 바로 돌아옵니다.
            </Text>
            <Pressable onPress={openLogin} style={({ pressed }) => [styles.primaryButton, styles.loginButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>로그인하고 계속</Text>
            </Pressable>
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
              <Text style={styles.textButtonText}>다음에 고르기</Text>
            </Pressable>
          </View>
        ) : null}

        {hasProduct && product && canChoose && user && !isSuccess ? (
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
              placeholderTextColor="#89909C"
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
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  kicker: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 2.2, marginTop: 20 },
  title: { color: '#202124', fontSize: 30, lineHeight: 37, fontWeight: '800', letterSpacing: -0.8, marginTop: 9 },
  subtitle: { color: '#747985', fontSize: 14, lineHeight: 21, marginTop: 10 },
  productCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 14, marginTop: 26 },
  productIcon: { width: 86, height: 86, borderRadius: 18, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 42 },
  productCopy: { flex: 1, paddingLeft: 16 },
  productLabel: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  productName: { color: '#202124', fontSize: 19, fontWeight: '800', marginTop: 6 },
  productState: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 28, marginBottom: 10 },
  inputLabel: { color: '#202124', fontSize: 15, fontWeight: '800' },
  counter: { color: '#747985', fontSize: 12 },
  reviewInput: { minHeight: 126, borderRadius: 18, backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 15, color: '#202124', fontSize: 15, lineHeight: 22, textAlignVertical: 'top' },
  helperText: { color: '#747985', fontSize: 12, marginTop: 8 },
  primaryButton: { minHeight: 54, borderRadius: 17, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 24 },
  loginButton: { alignSelf: 'stretch' },
  primaryButtonDisabled: { opacity: 0.4 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 20 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 6 },
  textButtonText: { color: '#747985', fontSize: 13, fontWeight: '700' },
  stateCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 26, marginTop: 34 },
  stateTitle: { color: '#202124', fontSize: 19, fontWeight: '800', marginTop: 14 },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  errorBox: { backgroundColor: '#FFF0EB', borderRadius: 14, padding: 13, marginTop: 14 },
  errorText: { color: '#A9482D', fontSize: 12, lineHeight: 18 },
  successCard: { alignItems: 'center', paddingTop: 58 },
  successIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#EFEEFF', alignItems: 'center', justifyContent: 'center' },
  successIconText: { color: '#4945ED', fontSize: 34, fontWeight: '900' },
  successProduct: { color: '#202124', fontSize: 18, fontWeight: '800', marginTop: 24 },
  savedReview: { color: '#5F6470', fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 11, paddingHorizontal: 18 },
  pressed: { opacity: 0.7 },
});
