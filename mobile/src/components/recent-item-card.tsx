import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickThresholds, OnePickType } from '@/constants/onepick';
import type { FoodItemRecentRankingItem } from '@/repositories/interfaces/readRepository';

/**
 * One store's menu in the 7-day ranking (Figma 30-1): photo, then store (bold) + menu
 * and the count on one line. Counts below the exposure threshold stay hidden.
 */
export function RecentItemCard({ item, onOpen }: { item: FoodItemRecentRankingItem; onOpen: () => void }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const imageFailed = Boolean(item.thumbnailUrl && failedImage === item.thumbnailUrl);
  const label = `${item.itemName} ${item.categoryName}`;
  const showCount = item.pickCount >= OnePickThresholds.exploreRankingMinPicks;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} 보기`} onPress={onOpen}
    style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
    <View style={styles.photo}>
      {!imageFailed && item.thumbnailUrl ? <Image source={{ uri: item.thumbnailUrl }} accessibilityLabel={label}
        style={styles.image} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.thumbnailUrl}
        onError={() => setFailedImage(item.thumbnailUrl)} />
        : <View accessibilityLabel={`${label} 이미지 로딩 실패`} style={styles.placeholder}>
            <Text style={styles.placeholderText}>사진을 불러올 수 없어요.</Text>
          </View>}
    </View>
    <View style={styles.copy}>
      <Text numberOfLines={1} style={styles.name}>
        <Text style={styles.store}>{item.itemName}</Text> {item.categoryName}
      </Text>
      {showCount ? <Text style={styles.count}>원픽 {item.pickCount.toLocaleString()}</Text> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { width: '48%' },
  photo: { width: '100%', aspectRatio: 173 / 118, overflow: 'hidden', borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgPlaceholder },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.bgPlaceholder },
  placeholderText: { ...OnePickType.caption, color: OnePick.textSecondary },
  // Figma Menu Tile (303:425): image → text 8px; store (Bold 12) + menu (Regular 12) and the count (10) on one line, 8px apart.
  copy: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, minWidth: 0 },
  name: { ...OnePickType.caption, fontSize: 12, lineHeight: 24, color: OnePick.textPrimary, flexShrink: 1 },
  store: { fontWeight: '700' },
  count: { ...OnePickType.caption, fontSize: 10, lineHeight: 18, color: OnePick.textSecondary, flexShrink: 0 },
  pressed: { opacity: 0.9 },
});
