import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ProfilePickCard } from '@/components/profile-pick-card';
import { Icon } from '@/components/ui';
import { buildProfileThemeSections, defaultCollapsedProfilePickGroups } from '@/lib/profile/profilePickGroups';
import { categoryWithChannels } from '@/lib/home/homeChannels';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';
import type { Category } from '@/types/domain/category';
import { OnePick } from '@/constants/onepick';

const CHANNEL_LABELS: Record<string, string> = {
  offline: '매장',
  online: '온라인',
  recipe: '레시피',
};

type Props = {
  picks: PickReadItem[];
  categories: Category[];
  onPressPick: (pickId: string) => void;
  onPressItem: (itemId: string) => void;
  onPressProvider?: (providerId: string) => void;
};

export function ProfilePickGroups({ picks, categories, onPressPick, onPressItem, onPressProvider }: Props) {
  const sections = useMemo(() => buildProfileThemeSections(picks, categories), [picks, categories]);
  // The same parent can appear under two themes when a leaf is mapped elsewhere, so collapse state keys by theme too.
  const groups = useMemo(() => sections.flatMap((section) => section.groups.map((group) => ({ ...group, id: `${section.code}:${group.id}` }))), [sections]);
  // The screen-level SectionHeader already names the selected taste scope. A lone
  // theme header (for example FOOD 5 directly under 음식 원픽 5) only repeats it;
  // keep theme labels when multiple themes need separation.
  const showThemeHeaders = sections.length > 1;
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
                  <Icon name={isCollapsed ? 'chevronDown' : 'chevronUp'} size="sm" color={OnePick.textTertiary} style={styles.groupChevron} />
                </Pressable>

                {!isCollapsed ? (
                  <View style={styles.groupBody}>
                    {group.items.map((item) => {
                      const isFoodChannel = group.kind === 'channel';
                      const channelLabel = isFoodChannel ? CHANNEL_LABELS[group.id] : undefined;
                      const providerName = isFoodChannel
                        ? (group.id === 'recipe'
                          ? item.item?.creatorName ?? null
                          : item.item?.name ?? null)
                        : undefined;
                      const menuName = isFoodChannel
                        ? item.category?.name ?? '카테고리'
                        : item.item?.name ?? '정보를 확인할 수 없어요.';
                      return <ProfilePickCard
                        key={item.pick.id}
                        layout="row"
                        categoryName={isFoodChannel ? item.category?.name ?? '카테고리' : categoryWithChannels(item.category?.name ?? '카테고리', item.item?.channels)}
                        itemName={menuName}
                        providerName={providerName}
                        channelLabel={channelLabel}
                        review={item.pick.oneLineReview}
                        imageUri={item.item?.thumbnailUrl ?? item.item?.imageUrl ?? item.item?.imageSourceUrl}
                        itemId={item.item?.id}
                        itemStatus={item.item?.status}
                        hasPhoto={Boolean(item.item?.imagePath)}
                        onPressPick={() => onPressPick(item.pick.id)}
                        onPressItem={item.item ? () => onPressItem(item.pick.itemId) : undefined}
                        onPressProvider={item.item?.providerId && onPressProvider ? () => onPressProvider(item.item!.providerId!) : undefined}
                      />;
                    })}
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
  sectionCount: { color: OnePick.textSecondary, fontSize: 11, lineHeight: 16, fontWeight: '700' },
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
  groupChevron: { marginLeft: 8 },
  groupBody: { gap: 10 },
  pressed: { opacity: 0.68 },
});
