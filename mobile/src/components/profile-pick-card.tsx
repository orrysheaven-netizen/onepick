import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

type Props = {
  categoryName: string;
  itemName: string;
  /** Food-channel provider/source shown before the menu title. */
  providerName?: string | null;
  /** Short channel badge, e.g. 매장 / 온라인 / 레시피. */
  channelLabel?: string | null;
  review: string;
  imageUri?: string | null;
  itemId?: string;
  itemStatus?: string;
  hasPhoto?: boolean;
  muted?: boolean;
  statusText?: string | null;
  onPressPick: () => void;
  onPressItem?: () => void;
  onPressProvider?: () => void;
  /** `tile` is the 2-column collection card: square photo on top, one press opens the Pick. */
  layout?: 'row' | 'tile';
};

export function ProfilePickCard({
  categoryName,
  itemName,
  providerName,
  channelLabel,
  review,
  imageUri,
  itemId,
  itemStatus,
  hasPhoto,
  muted = false,
  statusText,
  onPressPick,
  onPressItem,
  onPressProvider,
  layout = 'row',
}: Props) {
  if (layout === 'tile') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${providerName ? `${providerName} ${itemName}` : `${categoryName} ${itemName}`} 원픽 상세 보기`}
        onPress={onPressPick}
        style={({ pressed }) => [styles.tile, muted && styles.cardMuted, pressed && styles.pressed]}>
        <PickPhoto square uri={imageUri} label={itemName} itemId={itemId} itemStatus={itemStatus} hasPhoto={hasPhoto} />
        <View style={styles.tileCopy}>
          <Text numberOfLines={1} style={styles.tileCategory}>{categoryName}</Text>
          <Text numberOfLines={2} style={styles.tileName}>{itemName}</Text>
          <Text numberOfLines={2} style={styles.tileReview}>“{review}”</Text>
          {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
        </View>
      </Pressable>
    );
  }
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
          accessibilityLabel={`${providerName ? `${providerName} ${itemName}` : `${categoryName} ${itemName}`} 원픽 상세 보기`}
          onPress={onPressPick}
          style={({ pressed }) => [styles.mainAction, pressed && styles.pressed]}>
          {providerName || channelLabel ? (
            <View style={styles.contextRow}>
              {channelLabel ? <View style={styles.channelBadge}><Text style={styles.channelBadgeText}>{channelLabel}</Text></View> : null}
              {providerName ? (onPressProvider
                ? <Pressable accessibilityRole="button" accessibilityLabel={`${providerName} 제공처 프로필 보기`}
                    onPress={(event) => { event?.stopPropagation?.(); onPressProvider(); }}
                    style={({ pressed }) => [styles.providerLink, pressed && styles.pressed]}>
                    <Text numberOfLines={1} style={styles.providerName}>{providerName}</Text>
                    <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
                  </Pressable>
                : <Text numberOfLines={1} style={styles.providerName}>{providerName}</Text>) : null}
              {!providerName || !onPressProvider ? <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.chevron} /> : null}
            </View>
          ) : (
            <View style={styles.categoryRow}>
              <View style={styles.categoryPill}>
                <Text numberOfLines={1} style={styles.category}>{categoryName}</Text>
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} style={styles.chevron} />
            </View>
          )}

          <Text numberOfLines={2} style={styles.name}>{itemName}</Text>
          <Text numberOfLines={2} style={styles.review}>“{review}”</Text>
          {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
        </Pressable>

        {onPressItem ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${itemName} 상세 보기`}
            hitSlop={4}
            onPress={onPressItem}
            style={({ pressed }) => [styles.itemAction, pressed && styles.pressed]}>
            <Text style={styles.itemActionText}>상세 보기</Text>
            <Icon name="chevronRight" size="sm" color={OnePick.accent} />
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
  tile: { flexGrow: 1, flexBasis: '46%', maxWidth: '48.5%', gap: 10, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 12 },
  tileCopy: { gap: 2 },
  tileCategory: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  tileName: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '700', letterSpacing: -0.3 },
  tileReview: { color: OnePick.muted, fontSize: 13, lineHeight: 18 },
  body: { flex: 1, minWidth: 0, paddingLeft: 12 },
  mainAction: { minHeight: 0 },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  channelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: OnePick.accentSoft },
  channelBadgeText: { color: OnePick.accentDeep, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  providerLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 3 },
  providerName: { flex: 1, minWidth: 0, color: OnePick.text, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  categoryPill: { maxWidth: '78%', borderRadius: 999, backgroundColor: OnePick.accentSoft, paddingHorizontal: 8, paddingVertical: 3 },
  category: { color: OnePick.accentDeep, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  chevron: { marginTop: -2  },
  name: { color: OnePick.text, fontSize: 15, lineHeight: 21, fontWeight: '700', letterSpacing: -0.3, marginTop: 6 },
  review: { color: OnePick.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  status: { color: OnePick.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 4, fontWeight: '600' },
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
  pressed: { opacity: 0.68 },
});
