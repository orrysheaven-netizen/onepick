import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useProductDetail } from '@/hooks/useProductDetail';

export default function ProductDetailScreen() {
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const { user } = useAuthSession();
  const query = useProductDetail(productId, user?.id);

  if (query.isPending) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <ActivityIndicator />
          <Text style={styles.stateText}>제품 정보를 불러오고 있어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.centerState}>
          <Text style={styles.stateTitle}>제품을 볼 수 없어요</Text>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>돌아가기</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { product, category, myPickStatus, picks } = query.data;
  const openChoose = () => router.push({ pathname: '/pick/choose', params: { productId: product.id, categoryId: product.categoryId } });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <View style={styles.heroCard}>
          <View style={styles.productIcon}><Text style={styles.productEmoji}>🍜</Text></View>
          <Text style={styles.category}>{category?.name ?? '카테고리'}</Text>
          <Text style={styles.productName}>{product.name}</Text>
          <Text style={styles.productMeta}>
            {picks.length > 0 ? `${picks.length}명이 최근 이 제품을 원픽으로 골랐어요` : '아직 공개된 원픽 기록이 없어요'}
          </Text>

          <Pressable onPress={openChoose} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>
              {myPickStatus.type === 'selected_this'
                ? '내 원픽 한줄평 보기/수정'
                : myPickStatus.type === 'selected_other'
                  ? '이 제품으로 원픽 바꾸기'
                  : '이 제품을 내 원픽으로'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>이 제품을 고른 사람들</Text>
          <Text style={styles.sectionHint}>{picks.length}개 Pick</Text>
        </View>

        {picks.length > 0 ? (
          picks.map(({ pick, profile }) => (
            <Pressable
              key={pick.id}
              onPress={() => router.push({ pathname: '/pick/[pickId]', params: { pickId: pick.id } })}
              style={({ pressed }) => [styles.pickCard, pressed && styles.pressed]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.pickCopy}>
                <Text style={styles.username}>@{profile?.username ?? '사용자'}</Text>
                <Text style={styles.review}>“{pick.oneLineReview}”</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 이 제품의 원픽이 없어요</Text>
            <Text style={styles.emptyText}>첫 번째로 이 제품을 원픽으로 선택할 수 있어요.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  heroCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 26, padding: 28, marginTop: 8 },
  productIcon: { width: 122, height: 122, borderRadius: 30, backgroundColor: '#F4D7C5', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 58 },
  category: { color: '#D96D4B', fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginTop: 22 },
  productName: { color: '#202124', fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  productMeta: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  primaryButton: { width: '100%', minHeight: 50, borderRadius: 16, backgroundColor: '#D96D4B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 24 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 30, marginBottom: 12 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionHint: { color: '#8E8A85', fontSize: 11 },
  pickCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 13, marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF9F3', fontSize: 16, fontWeight: '900' },
  pickCopy: { flex: 1, marginLeft: 12 },
  username: { color: '#202124', fontSize: 12, fontWeight: '800' },
  review: { color: '#6C6863', fontSize: 12, lineHeight: 18, marginTop: 5 },
  arrow: { color: '#B8B1AA', fontSize: 25 },
  emptyCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  centerState: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: '#202124', fontSize: 20, fontWeight: '800' },
  stateText: { color: '#8E8A85', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  secondaryButton: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 17 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
