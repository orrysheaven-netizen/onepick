import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PickPhoto } from '@/components/pick-photo';
import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

import { Avatar } from './avatar';
import { PRESSED_OPACITY } from './touch';
import { Icon } from './icon';

type Props = {
  /** Short channel badge shown before the provider, e.g. 매장 / 온라인 / 레시피. */
  channelLabel?: string | null;
  /** Store, seller, brand or source. Kept visually separate from the menu title. */
  providerName?: string | null;
  /** The main content title. For food channel Picks this is the menu name. */
  itemName: string;
  /** D hierarchy: the surrounding screen already names the menu, so provider becomes the headline. */
  menuContext?: boolean;
  /** The one-line reason. Always rendered in quotes; it is the point of the card. */
  review?: string | null;
  /** Shown in place of a missing review. */
  fallbackText?: string;
  photo: {
    uri?: string | null;
    itemId?: string;
    itemStatus?: string;
    hasPhoto?: boolean;
    logoUri?: string | null;
    label?: string;
  };
  /** Who picked it. */
  person?: { username: string; label?: string; onPress?: () => void; accessibilityLabel?: string };
  onPress: () => void;
  /** Optional internal provider profile link for the context row. */
  onPressProvider?: () => void;
  accessibilityLabel: string;
  /** Low-noise state/actions under the body. */
  footer?: ReactNode;
};

export function PickCard({
  channelLabel, providerName, itemName, menuContext = false, review, fallbackText, photo,
  person, onPress, onPressProvider, accessibilityLabel, footer,
}: Props) {
  const showPhoto = Boolean(photo.uri || photo.logoUri || photo.hasPhoto);
  const showContext = Boolean(channelLabel || providerName);

  return (
    <View style={styles.card}>
      {person ? (
        <View style={styles.personRow}>
          <Avatar name={person.username} size={32} onPress={person.onPress} accessibilityLabel={person.accessibilityLabel} />
          <View style={styles.personCopy}>
            {person.onPress
              ? <Pressable accessibilityRole="button" accessibilityLabel={person.accessibilityLabel ?? `@${person.username} 프로필 보기`} onPress={person.onPress}
                  style={({ pressed }) => [styles.profileLink, pressed && styles.pressed]}>
                  <Text numberOfLines={1} style={styles.personLabel}>{person.label ?? `@${person.username}`}</Text>
                </Pressable>
              : <Text numberOfLines={1} style={styles.personLabel}>{person.label ?? `@${person.username}`}</Text>}
          </View>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
        style={({ pressed }) => [styles.body, !showPhoto && styles.bodyWithoutPhoto, pressed && styles.pressed]}>
        {showPhoto ? <PickPhoto feed uri={photo.uri} label={photo.label ?? itemName} itemId={photo.itemId}
          itemStatus={photo.itemStatus} hasPhoto={photo.hasPhoto} logoUri={photo.logoUri} /> : null}
        <View style={styles.copy}>
          {showContext ? <View style={styles.contextRow}>
            {channelLabel ? <View style={styles.channelBadge}><Text style={styles.channelBadgeText}>{channelLabel}</Text></View> : null}
            {providerName ? (onPressProvider
              ? <Pressable accessibilityRole="button" accessibilityLabel={`${providerName} 제공처 프로필 보기`}
                  onPress={(event) => { event?.stopPropagation?.(); onPressProvider(); }}
                  style={({ pressed }) => [styles.providerLink, pressed && styles.pressed]}>
                  <Text numberOfLines={1} style={menuContext ? styles.providerNameMenuContext : styles.providerName}>{providerName}</Text>
                  <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
                </Pressable>
              : <Text numberOfLines={1} style={menuContext ? styles.providerNameMenuContext : styles.providerName}>{providerName}</Text>) : null}
          </View> : null}
          {!menuContext || !providerName ? <Text style={styles.itemName}>{itemName}</Text> : null}
          {review
            ? <Text numberOfLines={3} style={styles.review}>{`“${review}”`}</Text>
            : fallbackText ? <Text style={styles.fallback}>{fallbackText}</Text> : null}
        </View>
      </Pressable>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, backgroundColor: OnePick.bgDefault, borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.lg },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  personCopy: { flex: 1, minWidth: 0, gap: 1 },
  profileLink: { alignSelf: 'flex-start', maxWidth: '100%' },
  personLabel: { ...OnePickType.bodyMedium, color: OnePick.text },
  body: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bodyWithoutPhoto: { minHeight: 0 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  channelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: OnePickRadius.sm, backgroundColor: OnePick.bgAccentSubtle },
  channelBadgeText: { ...OnePickType.captionMedium, color: OnePick.accentDeep },
  providerLink: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  providerName: { ...OnePickType.bodyMedium, color: OnePick.text, flexShrink: 1 },
  providerNameMenuContext: { ...OnePickType.headline, color: OnePick.text, flexShrink: 1 },
  itemName: { ...OnePickType.headline, color: OnePick.text },
  review: { ...OnePickType.body, color: OnePick.text },
  fallback: { ...OnePickType.caption, color: OnePick.muted },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 6 },
  pressed: { opacity: PRESSED_OPACITY },
});
