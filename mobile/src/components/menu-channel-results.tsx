import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { Chip, StateCard } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { useMenuChannelItems } from '@/hooks/useExploreData';
import { useItemSearch } from '@/hooks/useItemSearch';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { Category } from '@/types/domain/category';

/** Explore menu tabs: where to eat it (매장), order it (온라인), or cook it (레시피). */
export type MenuResultTab = PickChannel | 'recipe';

export const MENU_RESULT_TABS: readonly { key: MenuResultTab; label: string }[] = [
  { key: 'offline', label: '매장' },
  { key: 'online', label: '온라인' },
  { key: 'recipe', label: '레시피' },
];

type Row = { itemId: string; name: string; thumbnailUrl: string | null; meta: string | null };

type Props = {
  menu: Category;
  /** The 레시피 category (YouTube recipe videos); absent until it is open. */
  recipeCategory?: Category;
  onOpenItem: (itemId: string) => void;
  onRegister: (tab: MenuResultTab) => void;
};

export function MenuChannelResults({ menu, recipeCategory, onOpenItem, onRegister }: Props) {
  const [tab, setTab] = useState<MenuResultTab>('offline');
  const channelItems = useMenuChannelItems(menu.id);
  // Recipes are their own category: videos whose title names this menu.
  const recipes = useItemSearch(menu.name, undefined, recipeCategory ? [recipeCategory.id] : []);

  const rowsFor = (key: MenuResultTab): Row[] | undefined => {
    if (key === 'recipe') {
      if (!recipeCategory) return [];
      return recipes.data?.map((item) => ({
        itemId: item.id, name: item.name,
        thumbnailUrl: item.thumbnailUrl ?? item.imageUrl ?? item.imageSourceUrl ?? null,
        meta: item.creatorName ?? null,
      }));
    }
    return channelItems.data?.filter((item) => item.channel === key).map((item) => ({
      itemId: item.itemId, name: item.name, thumbnailUrl: item.thumbnailUrl,
      meta: item.pickCount > 0 ? `${item.pickCount.toLocaleString()}명의 원픽` : null,
    }));
  };
  const source = tab === 'recipe' ? recipes : channelItems;
  const rows = rowsFor(tab);
  const loading = tab === 'recipe'
    ? Boolean(recipeCategory) && (recipes.isWaiting || recipes.isPending)
    : channelItems.isPending;
  const tabLabel = MENU_RESULT_TABS.find((entry) => entry.key === tab)?.label ?? '';
  const canRegister = tab !== 'recipe' || Boolean(recipeCategory);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.kicker}>메뉴</Text>
        <Text style={styles.title}>{menu.name}</Text>
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        {MENU_RESULT_TABS.map((entry) => {
          const count = rowsFor(entry.key)?.length;
          return <Chip key={entry.key} selected={tab === entry.key}
            label={count ? `${entry.label} ${count}` : entry.label}
            accessibilityLabel={`${menu.name} ${entry.label}${count ? ` ${count}개` : ''} 보기`}
            onPress={() => setTab(entry.key)} />;
        })}
      </View>
      {loading ? <ActivityIndicator accessibilityLabel={`${tabLabel} 불러오는 중`} style={styles.loading} /> : null}
      {!loading && source.isError ? <StateCard compact tone="danger" title={`${tabLabel} 목록을 불러오지 못했어요`}
        action={{ label: '다시 불러오기', disabled: source.isFetching, onPress: () => { if (!source.isFetching) void source.refetch(); } }} /> : null}
      {!loading && !source.isError && rows?.map((row) => <View key={row.itemId} style={styles.card}>
        <PickPhoto uri={row.thumbnailUrl} label={row.name} itemId={row.itemId} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${row.name}, ${menu.name} ${tabLabel}, 상세 보기`}
          onPress={() => onOpenItem(row.itemId)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <View style={styles.copy}>
            <Text style={styles.name}>{row.name}</Text>
            {row.meta ? <Text style={styles.meta}>{row.meta}</Text> : null}
          </View>
          <Text style={styles.arrow}>›</Text>
        </Pressable>
      </View>)}
      {!loading && !source.isError && rows?.length === 0 ? <StateCard compact
        title={tab === 'recipe' && !recipeCategory ? '레시피는 준비 중이에요' : `아직 ${menu.name} ${tabLabel} 원픽이 없어요`}
        text={tab === 'recipe' && !recipeCategory ? '곧 요리 영상 레시피도 원픽으로 고를 수 있어요.' : '처음으로 원픽을 등록해보세요.'}
        action={canRegister ? { label: `${tabLabel} 원픽 등록하기`, variant: 'secondary', onPress: () => onRegister(tab) } : undefined} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 16, marginBottom: 16, borderRadius: 20, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  kicker: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  title: { color: OnePick.text, fontSize: 18, fontWeight: '900' },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 12 },
  loading: { marginVertical: 16 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 10, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.background },
  action: { flex: 1, minHeight: 72, flexDirection: 'row', alignItems: 'center' },
  copy: { flex: 1, paddingLeft: 12 },
  name: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  meta: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  arrow: { color: OnePick.hint, fontSize: 25, marginLeft: 5 },
  pressed: { opacity: 0.7 },
});
