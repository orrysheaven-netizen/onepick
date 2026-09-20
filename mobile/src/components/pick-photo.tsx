import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { OnePick } from '@/constants/onepick';

type Props = {
  uri?: string | null;
  label: string;
  large?: boolean;
  /** Only real catalog items can receive a shared photo. Draft previews omit this. */
  itemId?: string;
  itemStatus?: string;
  /** Preserve existing-photo protection even when a read model has no usable URL. */
  hasPhoto?: boolean;
  /** Home feed portrait frame (3:4). Crops to fill instead of letterboxing. */
  tall?: boolean;
};

function AddPhotoButton({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label} 사진 등록`}
    onPress={(event) => {
      // A photo action must not also activate the enclosing product/selection card.
      event.stopPropagation();
      router.push({ pathname: '/item/[itemId]', params: { itemId, photo: '1' } });
    }} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
    <Text style={styles.addText}>사진 등록</Text>
  </Pressable>;
}

export function PickPhoto({ uri, label, large = false, itemId, itemStatus = 'active', hasPhoto = false, tall = false }: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const initial = Array.from(label.trim())[0]?.toUpperCase() ?? '1';
  const canAdd = Boolean(itemId && !uri && !hasPhoto && ['active', 'discontinued'].includes(itemStatus));
  const failed = Boolean(uri && failedUri === uri);
  if (tall) {
    return <View style={[styles.frame, styles.tall]}>
      {uri && !failed
        ? <Image source={{ uri }} accessibilityLabel={label} style={styles.image} resizeMode="cover" onError={() => setFailedUri(uri)} />
        : <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.tallPlaceholder}>
            <Text numberOfLines={3} style={styles.tallPlaceholderName}>{label}</Text>
          </View>}
    </View>;
  }
  return <View style={[styles.frame, large && styles.large]}>
    {uri && !failed ? <Image source={{ uri }} accessibilityLabel={label} style={styles.image} resizeMode="contain" onError={() => setFailedUri(uri)} />
      : canAdd ? <View style={styles.empty}>
        <Text style={styles.emptyText}>사진 없음</Text>
        <AddPhotoButton itemId={itemId!} label={label} />
      </View>
      : failed ? <Text style={styles.fallback}>사진을 불러올 수 없어요</Text>
      : <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.placeholder}>
          <View style={styles.placeholderMark}><Text style={styles.placeholderInitial}>{initial}</Text></View>
          <Text numberOfLines={large ? 2 : 1} style={[styles.placeholderName, large && styles.placeholderNameLarge]}>{label}</Text>
          <Text style={styles.placeholderHint}>사진 준비 중</Text>
        </View>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: 86, height: 86, borderRadius: 16, overflow: 'hidden', backgroundColor: OnePick.sunken, justifyContent: 'center', alignItems: 'center' },
  large: { width: '100%', height: 230, marginBottom: 14 },
  tall: { width: 74, height: 94, borderRadius: 12 },
  tallPlaceholder: { width: '100%', height: '100%', justifyContent: 'flex-end', paddingHorizontal: 9, paddingVertical: 9, backgroundColor: OnePick.accent },
  tallPlaceholderName: { color: OnePick.onAccent, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  image: { width: '100%', height: '100%' },
  placeholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 7 },
  placeholderMark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  placeholderInitial: { color: OnePick.accent, fontSize: 13, fontWeight: '800' },
  placeholderName: { width: '100%', color: OnePick.text, fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', marginTop: 5 },
  placeholderNameLarge: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  placeholderHint: { color: OnePick.hint, fontSize: 9, lineHeight: 12, textAlign: 'center', marginTop: 2 },
  fallback: { color: OnePick.muted, fontSize: 12, textAlign: 'center', padding: 8 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: OnePick.muted, fontSize: 11, marginTop: 5 },
  addButton: { minHeight: 44, minWidth: 76, alignItems: 'center', justifyContent: 'center' },
  addText: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
