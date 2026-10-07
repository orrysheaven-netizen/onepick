import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { DishChannelOverview } from '@/components/dish-channel-overview';
import { DishPeoplePicks } from '@/components/dish-people-picks';
import { PickPhoto } from '@/components/pick-photo';
import { useDishChannels } from '@/hooks/useDishChannels';
import { useItemSearch } from '@/hooks/useItemSearch';
import type { PickChannel } from '@/lib/items/pickChannel';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

type ItemSearchProps = {
  categoryId?: string;
  compact?: boolean;
  initialQuery?: string;
  /** Defaults to the home wording; explore asks for a menu or store name (Figma 31). */
  placeholder?: string;
  onSubmitSearch?: (query: string) => void;
  onSearchMovie?: (query: string) => void;
  onSearchDrama?: (query: string) => void;
  onSearchMusic?: (query: string) => void;
  onSearchGame?: (query: string) => void;
  onSearchBook?: (query: string) => void;
  onSearchYouTube?: (query: string) => void;
  onSearchPokemon?: (query: string) => void;
  showExternalActionsWithResults?: boolean;
  /** Unscoped search only: a query naming a dish also shows the currently exposed channel(s). */
  dishChannels?: { userId?: string; channel?: PickChannel; onRegister?: (categoryId: string, channel: PickChannel) => void };
  onSelect: (itemId: string) => void;
};

type ExternalSearchAction = {
  key: 'movie' | 'drama' | 'music' | 'game' | 'book' | 'youtube' | 'pokemon';
  label: string;
  accessibilityLabel: string;
  run: () => void;
};

export function ItemSearch({
  categoryId,
  compact = false,
  initialQuery = '',
  placeholder = '어떤 원픽을 찾으세요?',
  onSubmitSearch,
  onSearchMovie,
  onSearchDrama,
  onSearchMusic,
  onSearchGame,
  onSearchBook,
  onSearchYouTube,
  onSearchPokemon,
  showExternalActionsWithResults = false,
  dishChannels,
  onSelect,
}: ItemSearchProps) {
  const [searchText, setSearchText] = useState(() => initialQuery.slice(0, 100));
  const query = useItemSearch(searchText, categoryId);
  const dish = useDishChannels(searchText, dishChannels?.userId, Boolean(dishChannels) && !categoryId);
  const normalizedSearch = searchText.trim().replace(/\s+/g, ' ');
  const isLoading = query.hasSearchText && (query.isWaiting || query.isPending);
  const externalActions: ExternalSearchAction[] = [];

  if (onSearchMovie && normalizedSearch.length >= 2) {
    externalActions.push({
      key: 'movie',
      label: '영화 DB에서 검색',
      accessibilityLabel: `${normalizedSearch} 영화 DB에서 검색`,
      run: () => onSearchMovie(normalizedSearch),
    });
  }
  if (onSearchDrama && normalizedSearch.length >= 2) {
    externalActions.push({
      key: 'drama',
      label: '드라마 DB에서 검색',
      accessibilityLabel: `${normalizedSearch} 드라마 DB에서 검색`,
      run: () => onSearchDrama(normalizedSearch),
    });
  }
  if (onSearchMusic && normalizedSearch.length >= 1) {
    externalActions.push({
      key: 'music',
      label: '음악 DB에서 검색',
      accessibilityLabel: `${normalizedSearch} 음악 DB에서 검색`,
      run: () => onSearchMusic(normalizedSearch),
    });
  }
  if (onSearchGame && normalizedSearch.length >= 2) {
    externalActions.push({
      key: 'game',
      label: '게임 DB에서 검색',
      accessibilityLabel: `${normalizedSearch} 게임 DB에서 검색`,
      run: () => onSearchGame(normalizedSearch),
    });
  }
  if (onSearchBook && normalizedSearch.length >= 2) {
    externalActions.push({
      key: 'book',
      label: '도서 DB에서 검색',
      accessibilityLabel: `${normalizedSearch} 도서 DB에서 검색`,
      run: () => onSearchBook(normalizedSearch),
    });
  }
  if (onSearchYouTube && normalizedSearch.length >= 2) {
    externalActions.push({
      key: 'youtube',
      label: 'YouTube 채널에서 검색',
      accessibilityLabel: `${normalizedSearch} YouTube 채널에서 검색`,
      run: () => onSearchYouTube(normalizedSearch),
    });
  }
  if (onSearchPokemon && normalizedSearch.length >= 1) {
    externalActions.push({
      key: 'pokemon',
      label: 'PokéAPI에서 포켓몬 검색',
      accessibilityLabel: `${normalizedSearch} PokéAPI에서 포켓몬 검색`,
      run: () => onSearchPokemon(normalizedSearch),
    });
  }

  const submitSearch = () => {
    if (!normalizedSearch) return;
    // A category-scoped catalog search has exactly one destination. Global
    // search goes to the dedicated search surface instead of doing nothing.
    if (categoryId && externalActions.length === 1) {
      externalActions[0].run();
      return;
    }
    onSubmitSearch?.(normalizedSearch);
  };

  return (
    <View style={compact ? styles.compactContainer : styles.container}>
      {!compact ? <>
        <Text style={styles.title}>항목 찾기</Text>
        <Text style={styles.description}>{categoryId ? '선택한 카테고리에서 이름으로 검색해보세요.' : '모든 카테고리에서 이름으로 검색해보세요.'}</Text>
      </> : null}
      <View style={[styles.searchRow, compact && styles.compactSearchRow]}>
        <TextInput accessibilityLabel="항목명 검색" autoCapitalize="none" autoCorrect={false} maxLength={100}
          onChangeText={setSearchText} onSubmitEditing={submitSearch}
          placeholder={placeholder} placeholderTextColor={OnePick.textSecondary}
          returnKeyType="search" style={styles.input} value={searchText} />
        {searchText.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setSearchText('')} style={styles.clearButton}>
          <Text style={styles.clearText}>지우기</Text>
        </Pressable> : null}
        {onSubmitSearch ? <Pressable accessibilityRole="button" accessibilityLabel="검색 실행"
          accessibilityState={{ disabled: !normalizedSearch }} disabled={!normalizedSearch}
          onPress={submitSearch} style={({ pressed }) => [styles.submitButton, (!normalizedSearch || pressed) && styles.pressed]}>
          <Text style={styles.submitText}>검색하기</Text>
        </Pressable> : null}
      </View>
      {!compact && !query.hasSearchText ? <Text style={styles.description}>항목을 찾으면 상세 정보와 사람들의 선택을 볼 수 있어요.</Text> : null}
      {isLoading ? <View style={styles.state}><ActivityIndicator /><Text style={styles.description}>검색하고 있어요</Text></View> : null}
      {query.hasSearchText && !isLoading && query.isError ? <View style={styles.state}>
        <Text style={styles.description}>검색 결과를 불러오지 못했어요.</Text>
        <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.retryButton}><Text style={styles.retryText}>다시 검색하기</Text></Pressable>
      </View> : null}
      {query.hasSearchText && dish.data ? <>
        <DishChannelOverview overview={dish.data} onSelectItem={onSelect} onRegister={dishChannels?.onRegister}
          visibleChannels={dishChannels?.channel ? [dishChannels.channel] : undefined} />
        <DishPeoplePicks categoryId={dish.data.categoryId} categoryName={dish.data.categoryName} userId={dishChannels?.userId}
          fixedChannel={dishChannels?.channel} />
      </> : null}
      {query.hasSearchText && !isLoading && !query.isError && query.data ? <>
        <Text accessibilityLiveRegion="polite" style={styles.resultCount}>
          {query.data.length === 20 ? '검색 결과 · 최대 20개 표시' : `검색 결과 ${query.data.length}개`}
        </Text>
        {query.data.length === 0 ? <View style={styles.emptyState}>
          <Text style={styles.description}>
            {externalActions.length
              ? 'OnePick에 아직 등록된 항목이 없어요. 아래 외부 DB에서 계속 찾아보세요.'
              : '검색 결과가 없어요. 다른 이름이나 카테고리로 찾아보세요.'}
          </Text>
          {externalActions.map((action) => <Pressable key={action.key} accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel} onPress={action.run}
            style={({ pressed }) => [styles.externalSearchButton, pressed && styles.pressed]}>
            <Text style={styles.externalSearchText}>{action.label}</Text>
          </Pressable>)}
        </View> : query.data.map((item) => <View key={item.id} style={styles.resultCard}>
          <PickPhoto uri={item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl} label={item.name}
            itemId={item.id} itemStatus={item.status} hasPhoto={Boolean(item.imagePath)} />
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} 상세 보기`} onPress={() => onSelect(item.id)}
            style={({ pressed }) => [styles.resultAction, pressed && styles.pressed]}>
            <View style={styles.resultCopy}>
              <Text style={styles.itemName}>{item.name}</Text>
              {item.creatorName || item.collectionName || item.releaseYear ? <Text numberOfLines={2} style={styles.itemMeta}>
                {[item.creatorName, item.collectionName, item.releaseYear].filter(Boolean).join(' · ')}
              </Text> : null}
              <Text style={styles.description}>상세 보기</Text>
            </View>
            <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.arrow} />
          </Pressable>
        </View>)}
        {showExternalActionsWithResults && query.data.length > 0 && externalActions.length > 0 ? <View style={styles.moreSearch}>
          <Text style={styles.moreSearchTitle}>외부 DB에서 더 정확히 찾기</Text>
          <Text style={styles.description}>원하는 항목이 아니라면 외부 카탈로그에서 같은 검색어로 계속 찾아보세요.</Text>
          {externalActions.map((action) => <Pressable key={action.key} accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel} onPress={action.run}
            style={({ pressed }) => [styles.externalSearchButton, pressed && styles.pressed]}>
            <Text style={styles.externalSearchText}>{action.label}</Text>
          </Pressable>)}
        </View> : null}
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 20, marginBottom: 28 },
  compactContainer: { marginBottom: 16 },
  compactSearchRow: { marginTop: 0, borderWidth: 1, borderColor: OnePick.border },
  title: { color: OnePick.text, fontSize: 18, fontWeight: '800' },
  description: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: OnePick.surface, borderRadius: 16, marginTop: 12 },
  input: { flex: 1, minWidth: 0, minHeight: 50, color: OnePick.text, fontSize: 14, paddingHorizontal: 15, paddingVertical: 12 },
  clearButton: { minHeight: 44, minWidth: 58, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  submitButton: { minHeight: 40, minWidth: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: OnePick.accent, marginRight: 5, paddingHorizontal: 12 },
  submitText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  state: { alignItems: 'center', paddingVertical: 20 },
  retryButton: { backgroundColor: OnePick.text, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11, marginTop: 12 },
  retryText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  resultCount: { color: OnePick.accent, fontSize: 12, fontWeight: '700', marginVertical: 14 },
  emptyState: { alignItems: 'flex-start' },
  externalSearchButton: { minHeight: 44, justifyContent: 'center', borderRadius: 14, backgroundColor: OnePick.accentSoft, paddingHorizontal: 15, marginTop: 10 },
  externalSearchText: { color: OnePick.accent, fontSize: 13, fontWeight: '800' },
  resultCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 12, marginBottom: 10 },
  resultAction: { flex: 1, minHeight: 86, flexDirection: 'row', alignItems: 'center', paddingLeft: 12 },
  resultCopy: { flex: 1 },
  itemName: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  itemMeta: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  moreSearch: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: OnePick.border },
  moreSearchTitle: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  arrow: { marginLeft: 10  },
  pressed: { opacity: 0.7 },
});
