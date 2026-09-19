import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useProfileTasteComposition } from '@/hooks/useProfileTasteComposition';

const MINIMUM_PICKS = 5;

function progressWidth(current: number) {
  return `${Math.min(100, Math.max(0, (current / MINIMUM_PICKS) * 100))}%`;
}

export function ProfileTasteComposition({ profileId }: { profileId: string }) {
  const composition = useProfileTasteComposition(profileId);
  const value = composition.data;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.title}>내 취향 구성</Text>
        {value && value.totalPickCount >= MINIMUM_PICKS ? (
          <Text style={styles.headingHint}>원픽 {value.mappedPickCount}개 반영</Text>
        ) : null}
      </View>

      {composition.isPending ? (
        <View style={styles.stateCard}>
          <ActivityIndicator />
          <Text style={styles.stateText}>내 원픽을 취향별로 정리하고 있어요.</Text>
        </View>
      ) : composition.isError || !value ? (
        <View style={styles.stateCard}>
          <Text accessibilityRole="alert" style={styles.errorText}>취향 구성을 불러오지 못했어요.</Text>
          <Text style={styles.stateText}>새로고침하면 다시 확인할 수 있어요.</Text>
        </View>
      ) : value.totalPickCount < MINIMUM_PICKS ? (
        <View style={styles.stateCard}>
          <Text style={styles.collectingTitle}>취향을 모으는 중 · 원픽 {value.totalPickCount}개</Text>
          <Text style={styles.stateText}>원픽 5개부터 내가 고른 취향의 구성을 보여드려요.</Text>
          <View style={styles.collectingTrack}>
            <View style={[styles.collectingFill, { width: progressWidth(value.totalPickCount) }]} />
          </View>
        </View>
      ) : value.dimensions.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.collectingTitle}>아직 분류된 취향 구성이 없어요.</Text>
          <Text style={styles.stateText}>카테고리의 취향 분류 기준이 준비되면 자동으로 반영됩니다.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.description}>원픽을 취향 영역별로 묶어, 지금 내 선택이 어디에 모여 있는지 보여줘요.</Text>
          {value.dimensions.map((dimension) => (
            <View key={dimension.code} style={styles.dimension}>
              <View style={styles.dimensionTopRow}>
                <View style={styles.dimensionCopy}>
                  <Text style={styles.dimensionName}>{dimension.name}</Text>
                  <Text style={styles.dimensionMeta}>{dimension.pickCount}개 · {dimension.categoryCount}개 카테고리</Text>
                </View>
                <Text style={styles.percentage}>{dimension.percentage.toFixed(1)}%</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, dimension.percentage))}%` }]} />
              </View>
              {dimension.categories.length > 0 ? (
                <View style={styles.categoryRow}>
                  {dimension.categories.map((category) => (
                    <View key={category.categoryId} style={styles.categoryChip}>
                      <Text style={styles.categoryText}>{category.categoryName}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          {value.unmappedPickCount > 0 ? (
            <Text style={styles.unmappedText}>원픽 {value.unmappedPickCount}개는 아직 취향 분류 기준이 없어 구성에서 제외됐어요.</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 22 },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  title: { color: '#202124', fontSize: 19, fontWeight: '900' },
  headingHint: { color: '#747985', fontSize: 11 },
  stateCard: { minHeight: 116, borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, justifyContent: 'center' },
  collectingTitle: { color: '#202124', fontSize: 14, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  errorText: { color: '#A9482D', fontSize: 13, fontWeight: '800' },
  collectingTrack: { height: 6, borderRadius: 999, backgroundColor: '#ECEEF3', overflow: 'hidden', marginTop: 15 },
  collectingFill: { height: '100%', borderRadius: 999, backgroundColor: '#4945ED' },
  card: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18 },
  description: { color: '#747985', fontSize: 12, lineHeight: 18, marginBottom: 4 },
  dimension: { paddingTop: 15 },
  dimensionTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  dimensionCopy: { flex: 1 },
  dimensionName: { color: '#202124', fontSize: 14, fontWeight: '900' },
  dimensionMeta: { color: '#89909C', fontSize: 11, marginTop: 4 },
  percentage: { color: '#4945ED', fontSize: 13, fontWeight: '900' },
  track: { height: 6, borderRadius: 999, backgroundColor: '#ECEEF3', overflow: 'hidden', marginTop: 10 },
  fill: { height: '100%', borderRadius: 999, backgroundColor: '#4945ED' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  categoryChip: { borderRadius: 999, backgroundColor: '#F1F2F6', paddingHorizontal: 9, paddingVertical: 5 },
  categoryText: { color: '#5F6470', fontSize: 10, fontWeight: '700' },
  unmappedText: { color: '#89909C', fontSize: 10, lineHeight: 16, marginTop: 16 },
});
