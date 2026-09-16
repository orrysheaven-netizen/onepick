import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuthSession } from '@/hooks/useAuthSession';
import { usePickDetail } from '@/hooks/usePickDetail';

export default function PickDetailScreen() {
  const router = useRouter();
  const { pickId } = useLocalSearchParams<{ pickId?: string }>();
  const { user } = useAuthSession();
  const query = usePickDetail(pickId, user?.id);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        {query.isPending ? (
          <View style={styles.stateCard}>
            <ActivityIndicator />
            <Text style={styles.stateText}>원픽을 불러오고 있어요</Text>
          </View>
        ) : null}

        {query.isError || !query.data ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>원픽을 볼 수 없어요</Text>
            <Text style={styles.stateText}>삭제되었거나 볼 수 없는 기록일 수 있어요.</Text>
          </View>
        ) : null}

        {query.data ? (
          <>
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{query.data.profile.username.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.profileCopy}>
                <Text style={styles.eyebrow}>PICK BY</Text>
                <Text style={styles.username}>@{query.data.profile.username}</Text>
              </View>
              <View style={[styles.statusBadge, !query.data.isCurrent && styles.statusBadgeMuted]}>
                <Text style={[styles.statusText, !query.data.isCurrent && styles.statusTextMuted]}>
                  {query.data.isCurrent ? '현재 원픽' : '이전 원픽'}
                </Text>
              </View>
            </View>

            <View style={styles.heroCard}>
              <View style={styles.productIcon}><Text style={styles.productEmoji}>🍜</Text></View>
              <Text style={styles.category}>{query.data.category.name}</Text>
              <Text style={styles.productName}>{query.data.product.name}</Text>
              <Text style={styles.review}>“{query.data.pick.oneLineReview}”</Text>
            </View>

            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>선택 기록</Text>
              <Text style={styles.metaText}>
                {query.data.isCurrent
                  ? '지금 이 사용자가 선택한 원픽입니다.'
                  : query.data.pick.status === 'replaced'
                    ? '다른 원픽으로 변경되어 이전 기록으로 남아 있습니다.'
                    : '선택이 종료되어 이전 기록으로 남아 있습니다.'}
              </Text>
            </View>

            <View style={styles.placeholderCard}>
              <Text style={styles.placeholderTitle}>댓글</Text>
              <Text style={styles.placeholderText}>다음 단계에서 이 Pick을 중심으로 댓글이 연결됩니다.</Text>
            </View>

            <View style={styles.placeholderCard}>
              <Text style={styles.placeholderTitle}>공유</Text>
              <Text style={styles.placeholderText}>Pick 링크 공유는 댓글 이후 같은 상세 화면을 기준으로 연결합니다.</Text>
            </View>
          </>
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
  profileRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 22 },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF9F3', fontSize: 19, fontWeight: '900' },
  profileCopy: { flex: 1, marginLeft: 12 },
  eyebrow: { color: '#D96D4B', fontSize: 9, fontWeight: '800', letterSpacing: 1.8 },
  username: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 4 },
  statusBadge: { borderRadius: 999, backgroundColor: '#F9E4DB', paddingHorizontal: 11, paddingVertical: 7 },
  statusBadgeMuted: { backgroundColor: '#EEE8E2' },
  statusText: { color: '#D96D4B', fontSize: 10, fontWeight: '800' },
  statusTextMuted: { color: '#8E8A85' },
  heroCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 26, padding: 28 },
  productIcon: { width: 116, height: 116, borderRadius: 28, backgroundColor: '#F4D7C5', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 56 },
  category: { color: '#D96D4B', fontSize: 11, fontWeight: '800', letterSpacing: 1.3, marginTop: 22 },
  productName: { color: '#202124', fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  review: { color: '#5F5A54', fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 22 },
  metaCard: { backgroundColor: '#252B38', borderRadius: 20, padding: 18, marginTop: 14 },
  metaLabel: { color: '#F3B59D', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  metaText: { color: '#FFF9F3', fontSize: 13, lineHeight: 20, marginTop: 8 },
  placeholderCard: { borderWidth: 1, borderColor: '#E3DCD5', borderRadius: 20, padding: 18, marginTop: 14 },
  placeholderTitle: { color: '#202124', fontSize: 15, fontWeight: '800' },
  placeholderText: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 6 },
  stateCard: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 28, marginTop: 34 },
  stateTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  stateText: { color: '#8E8A85', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  pressed: { opacity: 0.7 },
});
