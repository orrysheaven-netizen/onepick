import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { useItemSearch } from '@/hooks/useItemSearch';

export function ItemSearch({ categoryId, compact = false, onSearchMovie, onSelect }: {
  categoryId?: string;
  compact?: boolean;
  onSearchMovie?: (query: string) => void;
  onSelect: (itemId: string) => void;
}) {
  const [searchText, setSearchText] = useState('');
  const query = useItemSearch(searchText, categoryId);
  const isLoading = query.hasSearchText && (query.isWaiting || query.isPending);
  return (
    <View style={compact ? styles.compactContainer : styles.container}>
      {!compact ? <>
        <Text style={styles.title}>제품 찾기</Text>
        <Text style={styles.description}>{categoryId ? '선택한 카테고리에서 제품명으로 검색해보세요.' : '모든 카테고리에서 제품명으로 검색해보세요.'}</Text>
      </> : null}
      <View style={[styles.searchRow, compact && styles.compactSearchRow]}>
        <TextInput accessibilityLabel="제품명 검색" autoCapitalize="none" autoCorrect={false} maxLength={100}
          onChangeText={setSearchText} placeholder="어떤 제품을 찾으세요?" placeholderTextColor="#89909C"
          returnKeyType="search" style={styles.input} value={searchText} />
        {searchText.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setSearchText('')} style={styles.clearButton}>
          <Text style={styles.clearText}>지우기</Text>
        </Pressable> : null}
      </View>
      {!compact && !query.hasSearchText ? <Text style={styles.description}>제품을 찾으면 상세 정보와 사람들의 선택을 볼 수 있어요.</Text> : null}
      {isLoading ? <View style={styles.state}><ActivityIndicator /><Text style={styles.description}>제품을 찾고 있어요</Text></View> : null}
      {query.hasSearchText && !isLoading && query.isError ? <View style={styles.state}>
        <Text style={styles.description}>검색 결과를 불러오지 못했어요.</Text>
        <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.retryButton}><Text style={styles.retryText}>다시 검색하기</Text></Pressable>
      </View> : null}
      {query.hasSearchText && !isLoading && !query.isError && query.data ? <>
        <Text accessibilityLiveRegion="polite" style={styles.resultCount}>
          {query.data.length === 20 ? '검색 결과 · 최대 20개 표시' : `검색 결과 ${query.data.length}개`}
        </Text>
        {query.data.length === 0 ? <View style={styles.emptyState}>
          <Text style={styles.description}>일치하는 제품이 없어요. 다른 제품명이나 카테고리로 찾아보세요.</Text>
          {onSearchMovie && searchText.trim().length >= 2 ? <Pressable accessibilityRole="button"
            accessibilityLabel={`${searchText.trim()} 영화 DB에서 검색`} onPress={() => onSearchMovie(searchText.trim())} style={styles.movieSearchButton}>
            <Text style={styles.movieSearchText}>영화 DB에서 찾아보기</Text>
          </Pressable> : null}
        </View> : query.data.map((item) => <View key={item.id} style={styles.resultCard}>
          <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name}
            itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 제품 상세 보기`} onPress={() => onSelect(item.id)}
            style={({ pressed }) => [styles.resultAction, pressed && styles.pressed]}>
            <View style={styles.resultCopy}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.description}>제품 상세 보기</Text></View>
            <Text style={styles.arrow}>›</Text>
          </Pressable>
        </View>)}
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20, marginBottom: 28 },
  compactContainer: { marginBottom: 16 },
  compactSearchRow: { marginTop: 0, borderWidth: 1, borderColor: '#E3E5EA' },
  title: { color: '#202124', fontSize: 18, fontWeight: '800' },
  description: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, marginTop: 12 },
  input: { flex: 1, minWidth: 0, minHeight: 50, color: '#202124', fontSize: 14, paddingHorizontal: 15, paddingVertical: 12 },
  clearButton: { minHeight: 44, minWidth: 58, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: '#5F6470', fontSize: 12, fontWeight: '700' },
  state: { alignItems: 'center', paddingVertical: 20 },
  retryButton: { backgroundColor: '#202124', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, marginTop: 12 },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  resultCount: { color: '#4945ED', fontSize: 12, fontWeight: '700', marginVertical: 14 },
  emptyState: { alignItems: 'flex-start' },
  movieSearchButton: { minHeight: 44, justifyContent: 'center', borderRadius: 14, backgroundColor: '#EFEEFF', paddingHorizontal: 15, marginTop: 12 },
  movieSearchText: { color: '#4945ED', fontSize: 13, fontWeight: '800' },
  resultCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 12, marginBottom: 10 },
  resultAction: { flex: 1, minHeight: 86, flexDirection: 'row', alignItems: 'center', paddingLeft: 12 },
  resultCopy: { flex: 1 },
  itemName: { color: '#202124', fontSize: 15, fontWeight: '800' },
  arrow: { color: '#A6ADBB', fontSize: 25, marginLeft: 10 },
  pressed: { opacity: 0.7 },
});
