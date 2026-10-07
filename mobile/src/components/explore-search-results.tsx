import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, SectionHeader, StateCard } from '@/components/ui';
import { OnePick, OnePickSpace, OnePickThresholds, OnePickType } from '@/constants/onepick';
import { useItemSearch } from '@/hooks/useItemSearch';
import { useSearchItemMeta } from '@/hooks/useSearchItemMeta';
import { itemTitle } from '@/lib/items/itemTitle';
import type { Category } from '@/types/domain/category';

type Menu = { category: Category; count: number };

/** Figma 43: inline explore results — "메뉴 N" then "매장 원픽 N", or one empty state with registration. */
export function ExploreSearchResults({ query, menus, menuIds, onOpenMenu, onOpenItem, onRegister }: {
  query: string;
  menus: Menu[];
  menuIds: string[];
  onOpenMenu: (category: Category) => void;
  onOpenItem: (itemId: string) => void;
  onRegister: () => void;
}) {
  const needle = query.trim().replace(/\s+/g, ' ');
  const matchedMenus = menus.filter(({ category }) => category.name.toLowerCase().includes(needle.toLowerCase()));
  const search = useItemSearch(needle, undefined, menuIds);
  const items = search.data ?? [];
  const meta = useSearchItemMeta(items.map((item) => item.id));
  const menuName = new Map(menus.map(({ category }) => [category.id, category.name]));
  const searching = search.isWaiting || (search.isPending && search.fetchStatus !== 'idle');

  if (search.isError) {
    return <StateCard tone="danger" title="검색 결과를 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
      action={{ label: '다시 검색하기', onPress: () => void search.refetch() }} />;
  }
  if (searching && !matchedMenus.length) return <ActivityIndicator accessibilityLabel="검색하고 있어요" style={styles.loading} />;
  if (!searching && !matchedMenus.length && !items.length) {
    return <StateCard title={`‘${needle}’ 검색 결과가 없어요.`} text="다른 검색어로 찾아보거나 직접 원픽으로 등록할 수 있어요."
      action={{ label: '원픽 등록하기', variant: 'primary', onPress: onRegister }} />;
  }

  return (
    <View accessibilityLiveRegion="polite">
      {matchedMenus.length ? <>
        <SectionHeader title={`메뉴 ${matchedMenus.length}`} />
        {matchedMenus.map(({ category, count }) => (
          <Pressable key={category.id} accessibilityRole="button" accessibilityLabel={`${category.name} 메뉴 원픽 보기`}
            onPress={() => onOpenMenu(category)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.copy}>
              <Text style={styles.name}>{category.name}</Text>
              <Text style={styles.meta}>{count >= OnePickThresholds.exploreRankingMinPicks ? `원픽 ${count}` : '원픽을 모으고 있어요.'}</Text>
            </View>
            <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
          </Pressable>
        ))}
      </> : null}
      {items.length ? <>
        {matchedMenus.length ? <View style={styles.gap} /> : null}
        <SectionHeader title={`매장 원픽 ${items.length}`} />
        {!matchedMenus.length ? <Text style={styles.notice}>메뉴 이름과 일치하는 결과는 없어요. 매장 이름이 들어간 원픽만 보여드려요.</Text> : null}
        {items.map((item) => {
          const title = itemTitle(item.name, menuName.get(item.categoryId), true);
          const info = meta.data?.[item.id];
          const line = [info?.pickCount ? `원픽 ${info.pickCount}` : null, info?.region].filter(Boolean).join(' ');
          return (
            <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${title} 상세 보기`}
              onPress={() => onOpenItem(item.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.copy}>
                <Text numberOfLines={1} style={styles.name}>{title}</Text>
                {line ? <Text style={styles.meta}>{line}</Text> : null}
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
            </Pressable>
          );
        })}
      </> : searching ? <ActivityIndicator accessibilityLabel="매장 원픽을 찾고 있어요" style={styles.loading} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: OnePickSpace.md,
    borderBottomWidth: 1,
    borderBottomColor: OnePick.borderDefault,
    paddingVertical: OnePickSpace.md,
  },
  copy: { flex: 1, minWidth: 0 },
  name: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  meta: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  notice: { ...OnePickType.caption, color: OnePick.textSecondary, marginBottom: OnePickSpace.sm },
  gap: { height: OnePickSpace.xl },
  loading: { marginTop: OnePickSpace.lg },
  pressed: { opacity: 0.7 },
});
