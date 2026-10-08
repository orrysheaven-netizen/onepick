import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useProfileTasteComposition } from '@/hooks/useProfileTasteComposition';
import type { ProfileTasteComposition as ProfileTasteCompositionValue } from '@/services/profileTasteCompositionService';
import { OnePick } from '@/constants/onepick';

const MINIMUM_PICKS = 5;

function progressWidth(current: number): `${number}%` {
  return `${Math.min(100, Math.max(0, (current / MINIMUM_PICKS) * 100))}%`;
}

export function ProfileTasteComposition({
  profileId,
  viewerId,
  variant = 'self',
  previewValue,
}: {
  profileId: string;
  viewerId?: string;
  variant?: 'self' | 'public';
  previewValue?: ProfileTasteCompositionValue;
}) {
  const composition = useProfileTasteComposition(previewValue ? undefined : profileId, viewerId);
  const value = previewValue ?? composition.data;
  const isSelf = variant === 'self';
  const isPending = previewValue ? false : composition.isPending;
  const isError = previewValue ? false : composition.isError;

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <Text style={styles.title}>{isSelf ? '내 취향 구성' : '취향 구성'}</Text>
        {value && value.totalPickCount >= MINIMUM_PICKS ? (
          <Text style={styles.headingHint}>
            {value.unmappedPickCount > 0
              ? `${value.mappedPickCount}/${value.totalPickCount}개 반영`
              : `원픽 ${value.mappedPickCount}개 반영`}
          </Text>
        ) : null}
      </View>

      {isPending ? (
        <View style={styles.stateCard}>
          <ActivityIndicator />
          <Text style={styles.stateText}>{isSelf ? '내 원픽을 취향별로 정리하고 있어요.' : '원픽을 취향별로 정리하고 있어요.'}</Text>
        </View>
      ) : isError || !value ? (
        <View style={styles.stateCard}>
          <Text accessibilityRole="alert" style={styles.errorText}>취향 구성을 불러오지 못했어요.</Text>
          <Text style={styles.stateText}>새로고침하면 다시 확인할 수 있어요.</Text>
        </View>
      ) : value.totalPickCount < MINIMUM_PICKS ? (
        <View style={styles.stateCard}>
          <Text style={styles.collectingTitle}>취향을 모으는 중 · 원픽 {value.totalPickCount}개</Text>
          <Text style={styles.stateText}>{isSelf ? '원픽 5개부터 내가 고른 취향의 구성을 보여드려요.' : '원픽 5개부터 이 프로필의 취향 구성을 보여드려요.'}</Text>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: MINIMUM_PICKS, now: Math.min(value.totalPickCount, MINIMUM_PICKS) }}
            style={styles.collectingTrack}>
            <View style={[styles.collectingFill, { width: progressWidth(value.totalPickCount) }]} />
          </View>
        </View>
      ) : value.dimensions.length === 0 ? (
        <View style={styles.stateCard}>
          <Text style={styles.collectingTitle}>아직 분류된 취향 구성이 없어요.</Text>
          <Text style={styles.stateText}>카테고리의 취향 분류 기준이 준비되면 자동으로 반영돼요.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.description}>
            {value.unmappedPickCount > 0
              ? `취향 분류가 준비된 원픽 ${value.mappedPickCount}개를 기준으로 구성했어요.`
              : '원픽을 취향 영역별로 묶어, 지금 내 선택이 어디에 모여 있는지 보여줘요.'}
          </Text>
          {value.dimensions.map((dimension) => (
            <View key={dimension.code} style={styles.dimension}>
              <View style={styles.dimensionTopRow}>
                <View style={styles.dimensionCopy}>
                  <Text style={styles.dimensionName}>{dimension.name}</Text>
                  <Text style={styles.dimensionMeta}>{dimension.pickCount}개 · {dimension.categoryCount}개 카테고리</Text>
                </View>
                <Text style={styles.percentage}>{dimension.percentage.toFixed(1)}%</Text>
              </View>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={`${dimension.name} 취향 비중`}
                accessibilityValue={{ min: 0, max: 100, now: dimension.percentage }}
                style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, dimension.percentage))}%` }]} />
              </View>
              {dimension.categories.length > 0 ? (
                <View style={styles.categoryRow}>
                  {dimension.categories.slice(0, 4).map((category) => (
                    <View key={category.categoryId} style={styles.categoryChip}>
                      <Text style={styles.categoryText}>{category.categoryName}</Text>
                    </View>
                  ))}
                  {dimension.categories.length > 4 ? (
                    <View style={[styles.categoryChip, styles.categoryMoreChip]}>
                      <Text style={[styles.categoryText, styles.categoryMoreText]}>+{dimension.categories.length - 4}</Text>
                    </View>
                  ) : null}
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
  section: { marginTop: 6, marginBottom: 18 },
  headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  title: { color: OnePick.text, fontSize: 19, fontWeight: '900' },
  headingHint: { color: OnePick.muted, fontSize: 11 },
  stateCard: { minHeight: 108, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 16, justifyContent: 'center' },
  collectingTitle: { color: OnePick.text, fontSize: 14, fontWeight: '800' },
  stateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 7 },
  errorText: { color: OnePick.danger, fontSize: 13, fontWeight: '800' },
  collectingTrack: { height: 6, borderRadius: 999, backgroundColor: OnePick.sunken, overflow: 'hidden', marginTop: 15 },
  collectingFill: { height: '100%', borderRadius: 999, backgroundColor: OnePick.accent },
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 18, padding: 16 },
  description: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginBottom: 2 },
  dimension: { paddingTop: 12 },
  dimensionTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  dimensionCopy: { flex: 1 },
  dimensionName: { color: OnePick.text, fontSize: 14, fontWeight: '900' },
  dimensionMeta: { color: OnePick.textSecondary, fontSize: 10, marginTop: 2 },
  percentage: { color: OnePick.accent, fontSize: 13, fontWeight: '900' },
  track: { height: 6, borderRadius: 999, backgroundColor: OnePick.sunken, overflow: 'hidden', marginTop: 8 },
  fill: { height: '100%', borderRadius: 999, backgroundColor: OnePick.accent },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  categoryChip: { borderRadius: 999, backgroundColor: OnePick.hairline, paddingHorizontal: 8, paddingVertical: 4 },
  categoryText: { color: OnePick.muted, fontSize: 10, fontWeight: '700' },
  categoryMoreChip: { backgroundColor: OnePick.accentSoft },
  categoryMoreText: { color: OnePick.accent, fontWeight: '900' },
  unmappedText: { color: OnePick.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 12 },
});
