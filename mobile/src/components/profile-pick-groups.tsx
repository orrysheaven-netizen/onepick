import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfilePickCard } from '@/components/profile-pick-card';
import { buildProfileThemeSections, defaultCollapsedProfilePickGroups } from '@/lib/profile/profilePickGroups';
import { categoryWithChannels } from '@/lib/home/homeChannels';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';
import { OnePick } from '@/constants/onepick';

type Props = {
  picks: PickReadItem[];
  categories: Category[];
  onPressPick: (pickId: string) => void;
  onPressItem: (itemId: string) => void;
};

export function ProfilePickGroups({ picks, categories, onPressPick, onPressItem }: Props) {
  const sections = useMemo(() => buildProfileThemeSections(picks, categories), [picks, categories]);
  // The same parent can appear under two themes when a leaf is mapped elsewhere, so collapse state keys by theme too.
  const groups = useMemo(() => sections.flatMap((section) => section.groups.map((group) => ({ ...group, id: `${section.code}:${group.id}` }))), [sections]);
  // Without theme data (catalog still loading) everything is 기타; skip the lone header then.
  const showThemeHeaders = !(sections.length === 1 && sections[0].code === 'other');
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
          <Text style={styles.toolbarText}>묶음 {groups.length}개</Text>
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

      {sections.map((section) => (
        <View key={section.code} style={styles.section}>
          {showThemeHeaders ? (
            <View accessibilityRole="header" accessibilityLabel={`${section.label} 원픽 ${section.pickCount}개`} style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <Text style={styles.sectionCount}>{section.pickCount}</Text>
            </View>
          ) : null}
          {section.groups.map((group) => {
            const groupKey = `${section.code}:${group.id}`;
            const isCollapsed = collapsed.has(groupKey);
            return (
              <View key={groupKey} style={styles.group}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${group.name} 그룹 ${isCollapsed ? '펼치기' : '접기'}`}
                  accessibilityState={{ expanded: !isCollapsed }}
                  onPress={() => toggleGroup(groupKey)}
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
                        categoryName={group.kind === 'channel' ? item.category?.name ?? '카테고리' : categoryWithChannels(item.category?.name ?? '카테고리', item.item?.channels)}
                        itemName={item.item?.name ?? '정보를 확인할 수 없어요'}
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
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 22 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingHorizontal: 2 },
  sectionLabel: { color: OnePick.text, fontSize: 12, lineHeight: 16, fontWeight: '900', letterSpacing: 1.5 },
  sectionCount: { color: OnePick.hint, fontSize: 11, lineHeight: 16, fontWeight: '700' },
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
  pressed: { opacity: 0.68 },
});
