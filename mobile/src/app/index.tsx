import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Product = {
  id: string;
  category: string;
  brand: string;
  name: string;
  note: string;
  emoji: string;
  color: string;
};

const categories = ['전체', '패션', '뷰티', '리빙', '테크'];
const products: Product[] = [
  { id: 'daily-bag', category: '패션', brand: 'ÖNE STUDIO', name: '데일리 토트백', note: '가볍게 매일 들기 좋은 기본 가방', emoji: '👜', color: '#F4D7C5' },
  { id: 'mug', category: '리빙', brand: 'MORNING CLUB', name: '오트밀 머그', note: '아침을 조금 더 느긋하게 만드는 컵', emoji: '☕', color: '#E7D6B7' },
  { id: 'headphones', category: '테크', brand: 'SONA', name: '노이즈 캔슬링 헤드폰', note: '집중이 필요한 날의 조용한 선택', emoji: '🎧', color: '#D4DDF1' },
];

function ProductCard({ product, saved, onToggle }: { product: Product; saved: boolean; onToggle: () => void }) {
  return (
    <View style={styles.productCard}>
      <View style={[styles.productImage, { backgroundColor: product.color }]}>
        <Text style={styles.productEmoji}>{product.emoji}</Text>
        <Pressable
          accessibilityLabel={saved ? `${product.name} 저장 취소` : `${product.name} 저장`}
          onPress={onToggle}
          style={({ pressed }) => [styles.bookmark, pressed && styles.pressed]}>
          <Text style={styles.bookmarkText}>{saved ? '♥' : '♡'}</Text>
        </Pressable>
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productBrand}>{product.brand}</Text>
        <Text style={styles.productName}>{product.name}</Text>
        <Text style={styles.productNote}>{product.note}</Text>
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [savedIds, setSavedIds] = useState<string[]>(['mug']);
  const [added, setAdded] = useState(false);
  const visibleProducts = selectedCategory === '전체' ? products : products.filter((product) => product.category === selectedCategory);

  const toggleSaved = (id: string) => {
    setSavedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>ONEPICK</Text>
            <Text style={styles.greeting}>나의 취향을{ '\n' }한 곳에 모아요</Text>
          </View>
          <View style={styles.avatar}><Text style={styles.avatarText}>오</Text></View>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput accessibilityLabel="제품 검색" placeholder="제품이나 브랜드를 찾아보세요" placeholderTextColor="#8E8A85" style={styles.searchInput} />
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroKicker}>TODAY'S PICK</Text>
            <Text style={styles.heroTitle}>오늘의 원픽을{ '\n' }발견해보세요.</Text>
            <Text style={styles.heroSub}>좋아하는 물건을 고르고{ '\n' }나만의 이유를 남겨보세요.</Text>
          </View>
          <Text style={styles.heroShape}>✦</Text>
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>카테고리</Text><Text style={styles.sectionHint}>취향별로 둘러보기</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          {categories.map((category) => (
            <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, selectedCategory === category && styles.categoryChipActive]}>
              <Text style={[styles.categoryText, selectedCategory === category && styles.categoryTextActive]}>{category}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>오늘 많이 고른 제품</Text><Text style={styles.countText}>{visibleProducts.length}개</Text></View>
        {visibleProducts.map((product) => <ProductCard key={product.id} product={product} saved={savedIds.includes(product.id)} onToggle={() => toggleSaved(product.id)} />)}

        <Pressable onPress={() => setAdded(true)} style={({ pressed }) => [styles.addCard, pressed && styles.pressed]}>
          <View style={styles.addIcon}><Text style={styles.addIconText}>＋</Text></View>
          <View style={styles.addCopy}>
            <Text style={styles.addTitle}>{added ? '원픽이 준비됐어요' : '나만의 원픽 추가하기'}</Text>
            <Text style={styles.addSub}>{added ? '다음 단계에서 제품 정보를 연결할 수 있어요.' : '아직 목록에 없는 제품도 직접 기록할 수 있어요.'}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 800, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, paddingBottom: 22 },
  eyebrow: { color: '#D96D4B', fontSize: 12, fontWeight: '800', letterSpacing: 2.8 },
  greeting: { color: '#202124', fontSize: 30, fontWeight: '800', lineHeight: 36, marginTop: 9, letterSpacing: -0.8 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FAF8F5', fontSize: 16, fontWeight: '800' },
  searchBox: { height: 52, backgroundColor: '#F0ECE7', borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 18 },
  searchIcon: { color: '#5F5A54', fontSize: 28, lineHeight: 28, transform: [{ rotate: '-20deg' }] },
  searchInput: { flex: 1, color: '#202124', fontSize: 14, marginLeft: 9, paddingVertical: 0 },
  heroCard: { minHeight: 184, borderRadius: 24, backgroundColor: '#252B38', overflow: 'hidden', flexDirection: 'row', justifyContent: 'space-between', padding: 24, marginBottom: 30 },
  heroCopy: { zIndex: 1 },
  heroKicker: { color: '#F3B59D', fontSize: 11, fontWeight: '800', letterSpacing: 2.2, marginBottom: 13 },
  heroTitle: { color: '#FFF9F3', fontSize: 25, lineHeight: 30, fontWeight: '800', letterSpacing: -0.6 },
  heroSub: { color: '#C8C9CD', fontSize: 13, lineHeight: 19, marginTop: 14 },
  heroShape: { color: '#E98A69', fontSize: 150, lineHeight: 150, position: 'absolute', right: 2, bottom: -34, opacity: 0.92 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 13 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  sectionHint: { color: '#8E8A85', fontSize: 12 },
  countText: { color: '#D96D4B', fontSize: 12, fontWeight: '700' },
  categoryList: { gap: 8, paddingBottom: 29 },
  categoryChip: { paddingHorizontal: 17, paddingVertical: 10, borderRadius: 30, backgroundColor: '#F0ECE7' },
  categoryChipActive: { backgroundColor: '#D96D4B' },
  categoryText: { color: '#6C6863', fontSize: 13, fontWeight: '700' },
  categoryTextActive: { color: '#FFF9F3' },
  productCard: { flexDirection: 'row', padding: 11, backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 11, shadowColor: '#31251F', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  productImage: { width: 102, height: 102, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  productEmoji: { fontSize: 48 },
  bookmark: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center', position: 'absolute', right: 7, top: 7 },
  bookmarkText: { color: '#D96D4B', fontSize: 19, lineHeight: 21 },
  productInfo: { flex: 1, paddingHorizontal: 14, paddingVertical: 7 },
  productBrand: { color: '#D96D4B', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  productName: { color: '#202124', fontSize: 17, fontWeight: '800', marginTop: 7 },
  productNote: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 8 },
  addCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.2, borderColor: '#E3DCD5', borderStyle: 'dashed', borderRadius: 20, padding: 16, marginTop: 10 },
  addIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F9E4DB', alignItems: 'center', justifyContent: 'center' },
  addIconText: { color: '#D96D4B', fontSize: 25, lineHeight: 27, fontWeight: '400' },
  addCopy: { flex: 1, marginLeft: 13 },
  addTitle: { color: '#202124', fontSize: 14, fontWeight: '800' },
  addSub: { color: '#8E8A85', fontSize: 11, marginTop: 5 },
  chevron: { color: '#B8B1AA', fontSize: 26, marginLeft: 8 },
  pressed: { opacity: 0.7 },
});

