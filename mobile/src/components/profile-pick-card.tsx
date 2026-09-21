import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';

type Props = {
  categoryName: string;
  itemName: string;
  review: string;
  imageUri?: string | null;
  itemId?: string;
  itemStatus?: string;
  hasPhoto?: boolean;
  muted?: boolean;
  statusText?: string | null;
  onPressPick: () => void;
  onPressItem?: () => void;
};

export function ProfilePickCard({
  categoryName,
  itemName,
  review,
  imageUri,
  itemId,
  itemStatus,
  hasPhoto,
  muted = false,
  statusText,
  onPressPick,
  onPressItem,
}: Props) {
  return (
    <View style={[styles.card, muted && styles.cardMuted]}>
      <PickPhoto
        uri={imageUri}
        label={itemName}
        itemId={itemId}
        itemStatus={itemStatus}
        hasPhoto={hasPhoto}
      />

      <View style={styles.body}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${categoryName} ${itemName} 원픽 상세 보기`}
          onPress={onPressPick}
          style={({ pressed }) => [styles.mainAction, pressed && styles.pressed]}>
          <View style={styles.categoryRow}>
            <View style={styles.categoryPill}>
              <Text numberOfLines={1} style={styles.category}>{categoryName}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>

          <Text numberOfLines={2} style={styles.name}>{itemName}</Text>
          <Text numberOfLines={2} style={styles.review}>“{review}”</Text>
          {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
        </Pressable>

        {onPressItem ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${itemName} 제품 상세 보기`}
            hitSlop={4}
            onPress={onPressItem}
            style={({ pressed }) => [styles.itemAction, pressed && styles.pressed]}>
            <Text style={styles.itemActionText}>제품 보기</Text>
            <Text style={styles.itemActionArrow}>›</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: OnePick.border,
    backgroundColor: OnePick.surface,
    borderRadius: 20,
    padding: 12,
    marginBottom: 10,
  },
  cardMuted: { opacity: 0.68 },
  body: { flex: 1, minWidth: 0, paddingLeft: 12 },
  mainAction: { minHeight: 76 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  categoryPill: { maxWidth: '78%', borderRadius: 999, backgroundColor: OnePick.accentSoft, paddingHorizontal: 8, paddingVertical: 3 },
  category: { color: OnePick.accentDeep, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  chevron: { color: OnePick.hint, fontSize: 22, lineHeight: 24, marginTop: -2 },
  name: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '700', letterSpacing: -0.3, marginTop: 6 },
  review: { color: OnePick.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  status: { color: OnePick.hint, fontSize: 12, lineHeight: 16, marginTop: 4, fontWeight: '600' },
  itemAction: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OnePick.sunken,
    marginTop: 6,
    paddingTop: 6,
  },
  itemActionText: { color: OnePick.accent, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  itemActionArrow: { color: OnePick.accent, fontSize: 15, lineHeight: 16 },
  pressed: { opacity: 0.68 },
});
