import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfilePickCard } from '@/components/profile-pick-card';
import { buildProfilePickGroups, defaultCollapsedProfilePickGroups } from '@/lib/profile/profilePickGroups';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';

type Props = {
  picks: PickReadItem[];
  categories: Category[];
  onPressPick: (pickId: string) => void;
  onPressItem: (itemId: string) => void;
};

export function ProfilePickGroups({ picks, categories, onPressPick, onPressItem }: Props) {
  const groups = useMemo(() => buildProfilePickGroups(picks, categories), [picks, categories]);
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
  toolbarText: { color: '#89909C', fontSize: 10, fontWeight: '700' },
  toolbarAction: { color: '#4945ED', fontSize: 11, fontWeight: '900' },
  group: { gap: 8 },
  groupHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    backgroundColor: '#ECEEF3',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  groupTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { flexShrink: 1, color: '#202124', fontSize: 13, fontWeight: '900' },
  countPill: { borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 7, paddingVertical: 2 },
  countText: { color: '#747985', fontSize: 9, fontWeight: '800' },
  groupChevron: { color: '#89909C', fontSize: 16, lineHeight: 18, marginLeft: 8 },
  groupBody: { paddingLeft: 6 },
  pressed: { opacity: 0.68 },
});
