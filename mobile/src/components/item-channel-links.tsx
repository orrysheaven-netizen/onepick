import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick } from '@/constants/onepick';
import { ITEM_CHANNEL_LINK_LABELS, opensLinkInSameTab, safeChannelUrl, type ItemChannelLink } from '@/lib/items/itemChannelLinks';
import { queryKeys } from '@/lib/query/queryKeys';
import { itemChannelLinkService } from '@/services/itemChannelLinkService';

/** Store/online links for an item. Optional: loading, errors and no links render nothing. */
export function ItemChannelLinks({ itemId }: { itemId: string }) {
  const query = useQuery({
    queryKey: queryKeys.items.channels(itemId),
    queryFn: () => itemChannelLinkService.list(itemId),
    retry: false,
  });
  const [openError, setOpenError] = useState(false);
  const links = query.data ?? [];
  if (!links.length) return null;
  const sameTab = Platform.OS === 'web'
    && opensLinkInSameTab((globalThis as { navigator?: { userAgent?: string; maxTouchPoints?: number } }).navigator);

  const open = async (link: ItemChannelLink) => {
    setOpenError(false);
    const safe = safeChannelUrl(link.url);
    if (!safe) { setOpenError(true); return; }
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        if (sameTab) window.location.assign(safe.url);
        else window.open(safe.url, '_blank', 'noopener,noreferrer');
      } else await Linking.openURL(safe.url);
    } catch { setOpenError(true); }
  };

  return (
    <View style={styles.list}>
      {links.map((link) => (
        <Pressable key={link.channel} accessibilityRole="link" accessibilityLabel={`${ITEM_CHANNEL_LINK_LABELS[link.channel]} (${link.host}${sameTab ? '' : ', 새 창'})`}
          onPress={() => void open(link)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <View style={styles.copy}>
            <Text style={styles.label}>{ITEM_CHANNEL_LINK_LABELS[link.channel]}</Text>
            <Text numberOfLines={1} style={styles.host}>{link.host}</Text>
          </View>
          <Text style={styles.arrow}>↗</Text>
        </Pressable>
      ))}
      {openError ? <Text accessibilityRole="alert" style={styles.error}>링크를 열지 못했어요. 다시 시도해주세요.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { width: '100%', gap: 8, marginTop: 16 },
  link: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  copy: { flex: 1, minWidth: 0 },
  label: { color: OnePick.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  host: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  arrow: { color: OnePick.accent, fontSize: 18, fontWeight: '700' },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
