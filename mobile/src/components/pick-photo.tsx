import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

export function PickPhoto({ uri, label, large = false }: { uri?: string | null; label: string; large?: boolean }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return <View style={[styles.frame, large && styles.large]}>
    {uri && failedUri !== uri ? <Image source={{ uri }} accessibilityLabel={label} style={styles.image} resizeMode="contain" onError={() => setFailedUri(uri)} />
      : <Text style={styles.fallback}>{uri ? '사진을 불러올 수 없어요' : '사진 없음'}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: 86, height: 86, borderRadius: 16, overflow: 'hidden', backgroundColor: '#EFE9E1', justifyContent: 'center', alignItems: 'center' },
  large: { width: '100%', height: 230, marginBottom: 14 },
  image: { width: '100%', height: '100%' },
  fallback: { color: '#8E8A85', fontSize: 11, textAlign: 'center', padding: 8 },
});
