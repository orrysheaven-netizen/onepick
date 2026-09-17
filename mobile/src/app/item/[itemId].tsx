import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { useItemDetail } from '@/hooks/useItemDetail';
import { ItemPickCount } from '@/components/item-pick-count';
import { PickPhoto } from '@/components/pick-photo';

export default function ItemDetailScreen() {
  const router = useRouter();
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const { user } = useAuthSession();
  const query = useItemDetail(itemId, user?.id);

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

  const { item, category, myPickStatus, picks, canChoose } = query.data;
  const openPickAction = () => {
    if (myPickStatus.type === 'selected_this') {
      router.push({ pathname: '/pick/[pickId]', params: { pickId: myPickStatus.pickId } });
      return;
    }
    if (!canChoose) return;
    router.push({ pathname: '/pick/register', params: { itemId: item.id, categoryId: item.categoryId } });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <View style={styles.heroCard}>
          <PickPhoto uri={item.imageUrl} label={item.name} large />
          <Text style={styles.category}>{category?.name ?? '카테고리'}</Text>
          <Text style={styles.itemName}>{item.name}</Text>
          <ItemPickCount itemId={item.id} />
          <Text style={styles.itemMeta}>
            {picks.length > 0 ? `최근 원픽 기록 ${picks.length}개를 보여드려요` : '아직 공개된 원픽 기록이 없어요'}
          </Text>

          {canChoose || myPickStatus.type === 'selected_this' ? (
            <Pressable accessibilityRole="button" onPress={openPickAction} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>
                {myPickStatus.type === 'selected_this'
                  ? '내 원픽 한줄평 보기/수정'
                  : myPickStatus.type === 'selected_other'
                    ? '이 제품으로 원픽 바꾸기'
                    : '이 제품으로 원픽 등록'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.itemMeta}>현재 이 제품이나 카테고리에서는 새 원픽을 선택할 수 없어요.</Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>이 제품을 고른 사람들</Text>
          <Text style={styles.sectionHint}>{picks.length}개 Pick</Text>
        </View>

        {picks.length > 0 ? (
          picks.map(({ pick, profile }) => (
            <View key={pick.id} style={styles.pickCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.pickCopy}>
                {profile ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`@${profile.username} 공개 프로필 보기`}
                    onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username } })}
                    style={({ pressed }) => [styles.profileLink, pressed && styles.pressed]}>
                    <Text style={styles.username}>@{profile.username} · 프로필 보기 ›</Text>
                  </Pressable>
                ) : <Text style={styles.username}>사용자</Text>}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="원픽 한줄평 상세 보기"
                  onPress={() => router.push({ pathname: '/pick/[pickId]', params: { pickId: pick.id } })}
                  style={({ pressed }) => [styles.reviewLink, pressed && styles.pressed]}>
                  <Text style={styles.review}>“{pick.oneLineReview}”</Text>
                  <Text style={styles.pickAction}>원픽 상세 보기 ›</Text>
                </Pressable>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>아직 이 제품의 원픽이 없어요</Text>
            <Text style={styles.emptyText}>{canChoose ? '첫 번째로 이 제품을 원픽으로 선택할 수 있어요.' : '새로운 선택을 받을 수 없는 제품이나 카테고리입니다.'}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  heroCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 26, padding: 28, marginTop: 8 },
  itemIcon: { width: 122, height: 122, borderRadius: 30, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  itemEmoji: { fontSize: 58 },
  category: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.3, marginTop: 22 },
  itemName: { color: '#202124', fontSize: 28, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  itemMeta: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  primaryButton: { width: '100%', minHeight: 50, borderRadius: 16, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 24 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 30, marginBottom: 12 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  sectionHint: { color: '#747985', fontSize: 12 },
  pickCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 13, marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  pickCopy: { flex: 1, marginLeft: 12 },
  username: { color: '#202124', fontSize: 12, fontWeight: '800' },
  review: { color: '#5F6470', fontSize: 12, lineHeight: 18, marginTop: 5 },
  profileLink: { minHeight: 44, justifyContent: 'center' },
  reviewLink: { minHeight: 44, justifyContent: 'center' },
  pickAction: { color: '#4945ED', fontSize: 12, marginTop: 7 },
  emptyCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24 },
  emptyTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  emptyText: { color: '#747985', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
  centerState: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateTitle: { color: '#202124', fontSize: 20, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  secondaryButton: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 17 },
  secondaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
