import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

export function PickPhoto({ uri, label, large = false }: { uri?: string | null; label: string; large?: boolean }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const initial = Array.from(label.trim())[0]?.toUpperCase() ?? '1';
  return <View style={[styles.frame, large && styles.large]}>
    {uri && failedUri !== uri ? <Image source={{ uri }} accessibilityLabel={label} style={styles.image} resizeMode="contain" onError={() => setFailedUri(uri)} />
      : <View accessibilityLabel={`${label} 이미지 준비 중`} style={styles.placeholder}>
          <View style={styles.placeholderMark}><Text style={styles.placeholderInitial}>{initial}</Text></View>
          <Text numberOfLines={large ? 2 : 1} style={[styles.placeholderName, large && styles.placeholderNameLarge]}>{label}</Text>
          <Text style={styles.placeholderHint}>사진 준비 중</Text>
        </View>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: 86, height: 86, borderRadius: 16, overflow: 'hidden', backgroundColor: '#F8F9FB', justifyContent: 'center', alignItems: 'center' },
  large: { width: '100%', height: 230, marginBottom: 14 },
  image: { width: '100%', height: '100%' },
  placeholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 7 },
  placeholderMark: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFEEFF' },
  placeholderInitial: { color: '#4945ED', fontSize: 13, fontWeight: '800' },
  placeholderName: { width: '100%', color: '#202124', fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center', marginTop: 5 },
  placeholderNameLarge: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  placeholderHint: { color: '#8A8F9B', fontSize: 9, lineHeight: 12, textAlign: 'center', marginTop: 2 },
});
