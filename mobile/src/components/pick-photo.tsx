import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { OnePick } from '@/constants/onepick';

type Props = {
  uri?: string | null;
  label: string;
  large?: boolean;
  /** Compact row thumbnail used by Figma 03 Profile. */
  size?: 62 | 64 | 86;
  /** Optional compact thumbnail radius override for Figma row variants. */
  compactRadius?: 8 | 12;
  /** Only real catalog items can receive a shared photo. Draft previews omit this. */
  itemId?: string;
  itemStatus?: string;
  /** Preserve existing-photo protection even when a read model has no usable URL. */
  hasPhoto?: boolean;
  /** Legacy compact Home feed frame. */
  feed?: boolean;
  /** Figma Feed Card v3 photo: full-width × 176px, radius 16, cover crop. */
  feedCard?: boolean;
  /** Profile tile frame: fills the column width at 1:1. */
  square?: boolean;
  /** The item's brand logo: a corner badge on the photo, or the image itself when there is no photo. */
  logoUri?: string | null;
};

function AddPhotoButton({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} 사진 등록`}
    onPress={(event) => {
      event.stopPropagation();
      router.push({ pathname: '/item/[itemId]', params: { itemId, photo: '1' } });
    }} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
    <Text style={styles.addText}>사진 등록</Text>
  </Pressable>;
}

function LogoBadge({ uri, large, onError }: { uri: string; large: boolean; onError: () => void }) {
  return <View style={[styles.badge, large && styles.badgeLarge]}>
    <Image source={{ uri }} accessibilityLabel="브랜드 로고" style={styles.image} contentFit="contain" cachePolicy="memory-disk" recyclingKey={uri} onError={onError} />
  </View>;
}

// Every frame is square and fits the whole photo inside it: restaurant photos
// come in any shape and cropping cut off the dish or the storefront.
// Image order: the menu photo, then the brand logo, then the name placeholder.
export function PickPhoto({ uri, label, large = false, size = 86, compactRadius, itemId, itemStatus = 'active', hasPhoto = false, feed = false, feedCard = false, square = false, logoUri }: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const initial = Array.from(label.trim())[0]?.toUpperCase() ?? '1';
  const compact = (size === 62 || size === 64) && !large && !feed && !feedCard && !square;
  const canAdd = Boolean(!compact && itemId && !uri && !hasPhoto && ['active', 'discontinued'].includes(itemStatus));
  const failed = Boolean(uri && failedUri === uri);
  const logo = logoUri && failedLogo !== logoUri ? logoUri : null;
  const showPhoto = Boolean(uri && !failed);
  const badge = showPhoto && logo ? <LogoBadge uri={logo} large={large || feedCard || square} onError={() => setFailedLogo(logo)} /> : null;
  const logoImage = !showPhoto && logo
    ? <View style={styles.logoFill}>
        <Image source={{ uri: logo }} accessibilityLabel={`${label} 브랜드 로고`} style={styles.image} contentFit="contain" cachePolicy="memory-disk" recyclingKey={logo} onError={() => setFailedLogo(logo)} />
      </View>
    : null;
  if (feedCard) {
    return <View style={[styles.frame, styles.feedCard]}>
      {showPhoto
        ? <Image source={{ uri: uri! }} accessibilityLabel={label} style={styles.image} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri!} onError={() => setFailedUri(uri!)} />
        : logoImage && canAdd ? <>
          {logoImage}
          <View style={styles.addOverLogo}><AddPhotoButton itemId={itemId!} label={label} /></View>
        </>
        : logoImage ? logoImage
        : canAdd ? <View style={styles.empty}><AddPhotoButton itemId={itemId!} label={label} /></View>
        : failed ? <Text style={styles.fallback}>사진을 불러올 수 없어요.</Text>
        : <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.compactPlaceholder} />}
      {badge}
    </View>;
  }
  if (feed) {
    return <View style={[styles.frame, styles.feed]}>
      {showPhoto
        ? <Image source={{ uri: uri! }} accessibilityLabel={label} style={styles.image} contentFit="contain" cachePolicy="memory-disk" recyclingKey={uri!} onError={() => setFailedUri(uri!)} />
        : logoImage ?? <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.feedPlaceholder}>
            <Text numberOfLines={3} style={styles.feedPlaceholderName}>{label}</Text>
          </View>}
      {badge}
    </View>;
  }
  // Only the thumbnail has a fixed size. react-native-web drops `height: undefined`
  // when merging styles, so a shared 86px height would win over aspectRatio and
  // turn the full-width frames into 86px-tall strips.
  return <View style={[styles.frame, large ? styles.large : square ? styles.square : size === 62 ? styles.thumb62 : size === 64 ? styles.thumb64 : styles.thumb, compact && compactRadius ? { borderRadius: compactRadius } : null]}>
    {showPhoto ? <Image source={{ uri: uri! }} accessibilityLabel={label} style={styles.image} contentFit="contain" cachePolicy="memory-disk" recyclingKey={uri!} onError={() => setFailedUri(uri!)} />
      : logoImage && canAdd ? <>
        {logoImage}
        <View style={styles.addOverLogo}><AddPhotoButton itemId={itemId!} label={label} /></View>
      </>
      : logoImage ? logoImage
      : canAdd ? <View style={styles.empty}>
        <AddPhotoButton itemId={itemId!} label={label} />
      </View>
      : failed ? <Text style={styles.fallback}>사진을 불러올 수 없어요.</Text>
      : compact ? <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.compactPlaceholder} />
      : <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.placeholder}>
          <View style={styles.placeholderMark}><Text style={styles.placeholderInitial}>{initial}</Text></View>
          <Text numberOfLines={large ? 2 : 1} style={[styles.placeholderName, large && styles.placeholderNameLarge]}>{label}</Text>
          <Text style={styles.placeholderHint}>사진 준비 중</Text>
        </View>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { borderRadius: 16, overflow: 'hidden', backgroundColor: OnePick.sunken, justifyContent: 'center', alignItems: 'center' },
  thumb: { width: 86, height: 86 },
  thumb62: { width: 62, height: 62, borderRadius: 12 },
  thumb64: { width: 64, height: 64, borderRadius: 8 },
  large: { width: '100%', aspectRatio: 1, marginBottom: 14 },
  feed: { width: 86, height: 86, borderRadius: 12 },
  feedCard: { width: '100%', height: 176, borderRadius: 16 },
  square: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  feedPlaceholder: { width: '100%', height: '100%', justifyContent: 'flex-end', paddingHorizontal: 9, paddingVertical: 9, backgroundColor: OnePick.accent },
  feedPlaceholderName: { color: OnePick.onAccent, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  image: { width: '100%', height: '100%' },
  // Logos are drawn for light backgrounds, so they sit on white in both themes.
  logoFill: { width: '100%', height: '100%', padding: '14%', backgroundColor: '#FFFFFF' },
  badge: { position: 'absolute', left: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, padding: 2, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: OnePick.border },
  badgeLarge: { left: 10, bottom: 10, width: 40, height: 40, borderRadius: 20, padding: 4 },
  addOverLogo: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', backgroundColor: OnePick.surface, opacity: 0.94 },
  compactPlaceholder: { width: '100%', height: '100%', backgroundColor: OnePick.bgPlaceholder },
  placeholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 7 },
  placeholderMark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  placeholderInitial: { color: OnePick.accent, fontSize: 13, fontWeight: '800' },
  placeholderName: { width: '100%', color: OnePick.text, fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', marginTop: 5 },
  placeholderNameLarge: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  placeholderHint: { color: OnePick.textSecondary, fontSize: 9, lineHeight: 12, textAlign: 'center', marginTop: 2 },
  fallback: { color: OnePick.muted, fontSize: 12, textAlign: 'center', padding: 8 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  addButton: { minHeight: 44, minWidth: 76, alignItems: 'center', justifyContent: 'center' },
  addText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});

