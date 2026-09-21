import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfilePickCard } from '@/components/profile-pick-card';
import { buildProfilePickGroups, defaultCollapsedProfilePickGroups, remainingProfileCategories } from '@/lib/profile/profilePickGroups';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';
import { OnePick } from '@/constants/onepick';

type Props = {
  picks: PickReadItem[];
  categories: Category[];
  onPressPick: (pickId: string) => void;
  onPressItem: (itemId: string) => void;
  /** Owner only: a dashed tile per group lists the pickable categories still without a Pick. */
  onPressCategory?: (category: Category) => void;
};

export function ProfilePickGroups({ picks, categories, onPressPick, onPressItem, onPressCategory }: Props) {
  const groups = useMemo(() => buildProfilePickGroups(picks, categories), [picks, categories]);
  const pickedCategoryIds = useMemo(() => new Set(picks.map((item) => item.pick.categoryId)), [picks]);
  const groupSignature = groups.map((group) => group.id).join('|');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsedProfilePickGroups(groups, picks.length));

  useEffect(() => {
    setCollapsed(defaultCollapsedProfilePickGroups(groups, picks.length));
  }, [groupSignature, picks.length]);

  const longProfile = picks.length > 6 && groups.length > 1;
  const allCollapsed = groups.length > 0 && groups.every((group) => collapsed.has(group.id));

  const toggleGroup = (groupId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(groups.map((group) => group.id)));
  };

  return (
    <View style={styles.container}>
      {longProfile ? (
        <View style={styles.toolbar}>
          <Text style={styles.toolbarText}>상위 카테고리 {groups.length}개</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allCollapsed ? '카테고리 그룹 모두 펼치기' : '카테고리 그룹 모두 접기'}
            hitSlop={6}
            onPress={toggleAll}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.toolbarAction}>{allCollapsed ? '모두 펼치기' : '모두 접기'}</Text>
          </Pressable>
        </View>
      ) : null}

      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return (
          <View key={group.id} style={styles.group}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.name} 그룹 ${isCollapsed ? '펼치기' : '접기'}`}
              accessibilityState={{ expanded: !isCollapsed }}
              onPress={() => toggleGroup(group.id)}
              style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}>
              <View style={styles.groupTitleRow}>
                <Text numberOfLines={1} style={styles.groupName}>{group.name}</Text>
                <View style={styles.countPill}><Text style={styles.countText}>{group.items.length}개</Text></View>
              </View>
              <Text style={styles.groupChevron}>{isCollapsed ? '⌄' : '⌃'}</Text>
            </Pressable>

            {!isCollapsed ? (
              <View style={styles.groupBody}>
                {group.items.map((item) => (
                  <ProfilePickCard
                    key={item.pick.id}
                    layout="tile"
                    categoryName={item.category?.name ?? '카테고리'}
                    itemName={item.item?.name ?? '제품 정보를 확인할 수 없어요'}
                    review={item.pick.oneLineReview}
                    imageUri={item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl}
                    itemId={item.item?.id}
                    itemStatus={item.item?.status}
                    hasPhoto={Boolean(item.item?.imagePath)}
                    onPressPick={() => onPressPick(item.pick.id)}
                    onPressItem={item.item ? () => onPressItem(item.pick.itemId) : undefined}
                  />
                ))}
                {onPressCategory ? (() => {
                  const remaining = remainingProfileCategories(group.id, pickedCategoryIds, categories);
                  if (!remaining.length) return null;
                  return <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${group.name}에서 ${remaining[0].name} 원픽 고르기`}
                    onPress={() => onPressCategory(remaining[0])}
                    style={({ pressed }) => [styles.remainingTile, pressed && styles.pressed]}>
                    <View style={styles.remainingMark}><Text style={styles.remainingPlus}>+</Text></View>
                    <Text style={styles.remainingTitle}>{group.name}에 {remaining.length}개 남았어요</Text>
                    <Text numberOfLines={2} style={styles.remainingText}>{remaining.map((category) => category.name).join(' · ')}</Text>
                  </Pressable>;
                })() : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 },
  toolbarText: { color: OnePick.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  toolbarAction: { color: OnePick.accent, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  group: { gap: 8 },
  groupHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    backgroundColor: OnePick.sunken,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  groupTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { flexShrink: 1, color: OnePick.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  countPill: { borderRadius: 999, backgroundColor: OnePick.surface, paddingHorizontal: 7, paddingVertical: 2 },
  countText: { color: OnePick.muted, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  groupChevron: { color: OnePick.hint, fontSize: 16, lineHeight: 18, marginLeft: 8 },
  groupBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  remainingTile: { flexGrow: 1, flexBasis: '46%', maxWidth: '48.5%', minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 12 },
  remainingMark: { width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  remainingPlus: { color: OnePick.accent, fontSize: 24, lineHeight: 28, fontWeight: '700' },
  remainingTitle: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '700', textAlign: 'center' },
  remainingText: { color: OnePick.muted, fontSize: 12, lineHeight: 16, textAlign: 'center' },
  pressed: { opacity: 0.68 },
});
