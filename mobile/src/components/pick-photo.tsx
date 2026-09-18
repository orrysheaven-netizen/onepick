import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  uri?: string | null;
  label: string;
  large?: boolean;
  /** Only real catalog items can receive a shared photo. Draft previews omit this. */
  itemId?: string;
  itemStatus?: string;
  /** Preserve existing-photo protection even when a read model has no usable URL. */
  hasPhoto?: boolean;
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

export function PickPhoto({ uri, label, large = false, itemId, itemStatus = 'active', hasPhoto = false }: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const canAdd = Boolean(itemId && !uri && !hasPhoto && ['active', 'discontinued'].includes(itemStatus));
  return <View style={[styles.frame, large && styles.large]}>
    {uri && failedUri !== uri ? <Image source={{ uri }} accessibilityLabel={label} style={styles.image} resizeMode="contain" onError={() => setFailedUri(uri)} />
      : canAdd ? <View style={styles.empty}>
        <Text style={styles.emptyText}>사진 없음</Text>
        <AddPhotoButton itemId={itemId!} label={label} />
      </View> : <Text style={styles.fallback}>{uri ? '사진을 불러올 수 없어요' : '사진 없음'}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: 86, height: 86, borderRadius: 16, overflow: 'hidden', backgroundColor: '#F8F9FB', justifyContent: 'center', alignItems: 'center' },
  large: { width: '100%', height: 230, marginBottom: 14 },
  image: { width: '100%', height: '100%' },
  fallback: { color: '#747985', fontSize: 12, textAlign: 'center', padding: 8 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#747985', fontSize: 11, marginTop: 5 },
  addButton: { minHeight: 44, minWidth: 76, alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
