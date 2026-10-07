import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { channelLabel } from '@/lib/home/homeChannels';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { DishChannelOverview as Overview } from '@/repositories/interfaces/readRepository';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

const CHANNELS: readonly PickChannel[] = ['offline', 'online', 'recipe'];

type Props = {
  overview: Overview;
  onSelectItem: (itemId: string) => void;
  /** Starts registration for this dish in one channel; omitted, empty channels only say so. */
  onRegister?: (categoryId: string, channel: PickChannel) => void;
  /** Public rollout may expose a subset while the internal three-channel model stays intact. */
  visibleChannels?: readonly PickChannel[];
};

/** A searched dish grouped by the channels currently exposed to the user. */
export function DishChannelOverview({ overview, onSelectItem, onRegister, visibleChannels }: Props) {
  const channels = visibleChannels?.length ? visibleChannels : CHANNELS;
  const singleOffline = channels.length === 1 && channels[0] === 'offline';
  return (
    <View accessibilityLabel={singleOffline ? `${overview.categoryName} 매장 원픽` : `${overview.categoryName} 채널별 원픽`} style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{overview.categoryName}</Text>
      <Text style={styles.subtitle}>{singleOffline ? '매장에서 먹은 메뉴 원픽을 보여드려요.' : '오프라인 맛집 · 온라인 맛집 · 레시피로 나눠 보여드려요.'}</Text>
      {channels.map((channel) => {
        const items = overview.channels[channel];
        const label = channelLabel(channel);
        return (
          <View key={channel} style={styles.section}>
            <Text style={styles.sectionTitle}>{label}</Text>
            {items.length ? items.map((item, index) => (
              <Pressable key={item.itemId} accessibilityRole="button"
                accessibilityLabel={`${label} ${index + 1}위, ${item.name}, ${item.pickCount}명이 원픽, 상세 보기`}
                onPress={() => onSelectItem(item.itemId)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <Text style={styles.rank}>{index + 1}</Text>
                <PickPhoto uri={item.thumbnailUrl} label={item.name} logoUri={item.brandLogoUrl} />
                <View style={styles.copy}>
                  <Text numberOfLines={2} style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{item.pickCount}명이 원픽</Text>
                </View>
                <Icon name="chevronRight" size="sm" color={OnePick.textSecondary} />
              </Pressable>
            )) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{onRegister ? `${overview.categoryName} ${label}의 첫 원픽을 골라보세요.` : `아직 ${overview.categoryName} ${label} 원픽이 없어요.`}</Text>
                {onRegister ? <Pressable accessibilityRole="button" accessibilityLabel={`${overview.categoryName} ${label} 원픽 등록하기`}
                  onPress={() => onRegister(overview.categoryId, channel)} style={({ pressed }) => [styles.register, pressed && styles.pressed]}>
                  <Text style={styles.registerText}>첫 원픽 등록하기 ›</Text>
                </Pressable> : null}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 14, marginTop: 12 },
  title: { color: OnePick.text, fontSize: 18, fontWeight: '800' },
  subtitle: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  section: { marginTop: 14 },
  sectionTitle: { color: OnePick.accent, fontSize: 13, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 6 },
  rank: { width: 16, color: OnePick.muted, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  copy: { flex: 1 },
  name: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  meta: { color: OnePick.muted, fontSize: 12, marginTop: 2 },
  empty: { paddingVertical: 6 },
  emptyText: { color: OnePick.muted, fontSize: 12, lineHeight: 18 },
  register: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  registerText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
