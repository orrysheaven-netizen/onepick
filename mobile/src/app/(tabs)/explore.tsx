import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const categories = ['전체', '패션', '뷰티', '리빙', '테크'];
const rankings = [
  { rank: '01', category: '패션', name: '데일리 토트백', detail: '가볍고 오래 쓰는 기본 가방', emoji: '👜', color: '#F4D7C5' },
  { rank: '02', category: '리빙', name: '오트밀 머그', detail: '아침을 위한 따뜻한 한 잔', emoji: '☕', color: '#E7D6B7' },
  { rank: '03', category: '테크', name: '노이즈 캔슬링 헤드폰', detail: '집중을 위한 조용한 선택', emoji: '🎧', color: '#D4DDF1' },
  { rank: '04', category: '뷰티', name: '라이트 글로우 크림', detail: '매일 쓰는 산뜻한 보습', emoji: '🧴', color: '#E7D7E2' },
];

export default function ExploreScreen() {
  const [selected, setSelected] = useState('전체');
  const filtered = useMemo(() => selected === '전체' ? rankings : rankings.filter((item) => item.category === selected), [selected]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>EXPLORE</Text>
        <Text style={styles.title}>사람들의 원픽을{ '\n' }구경해보세요</Text>
        <Text style={styles.subtitle}>많이 선택한 제품부터 취향이 비슷한 사람들의 기록까지.</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          {categories.map((category) => (
            <Pressable key={category} onPress={() => setSelected(category)} style={[styles.chip, selected === category && styles.chipActive]}>
              <Text style={[styles.chipText, selected === category && styles.chipTextActive]}>{category}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.listHeader}><Text style={styles.listTitle}>이번 주 인기 원픽</Text><Text style={styles.updated}>방금 업데이트</Text></View>
        {filtered.map((item) => (
          <View style={styles.rankCard} key={item.rank}>
            <Text style={styles.rank}>{item.rank}</Text>
            <View style={[styles.thumb, { backgroundColor: item.color }]}><Text style={styles.emoji}>{item.emoji}</Text></View>
            <View style={styles.rankCopy}><Text style={styles.category}>{item.category}</Text><Text style={styles.name}>{item.name}</Text><Text style={styles.detail}>{item.detail}</Text></View>
            <Text style={styles.arrow}>›</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 110 },
  eyebrow: { color: '#D96D4B', fontSize: 12, fontWeight: '800', letterSpacing: 2.8 },
  title: { color: '#202124', fontSize: 30, fontWeight: '800', lineHeight: 36, letterSpacing: -0.8, marginTop: 10 },
  subtitle: { color: '#8E8A85', fontSize: 13, lineHeight: 20, marginTop: 13, maxWidth: 330 },
  categoryList: { gap: 8, paddingVertical: 28 },
  chip: { backgroundColor: '#F0ECE7', borderRadius: 30, paddingHorizontal: 17, paddingVertical: 10 },
  chipActive: { backgroundColor: '#D96D4B' },
  chipText: { color: '#6C6863', fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: '#FFF9F3' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 13 },
  listTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  updated: { color: '#8E8A85', fontSize: 11 },
  rankCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, marginBottom: 11 },
  rank: { width: 27, color: '#D2CBC4', fontSize: 12, fontWeight: '800' },
  thumb: { width: 70, height: 70, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 33 },
  rankCopy: { flex: 1, paddingLeft: 13 },
  category: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  name: { color: '#202124', fontSize: 15, fontWeight: '800', marginTop: 5 },
  detail: { color: '#8E8A85', fontSize: 11, marginTop: 5 },
  arrow: { color: '#B8B1AA', fontSize: 25, marginLeft: 5 },
});
