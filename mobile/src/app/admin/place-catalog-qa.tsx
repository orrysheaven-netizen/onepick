import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { OnePick } from '@/constants/onepick';
import { getSbizPlaceSample } from '@/lib/admin-api';
import type { AdminSbizPlaceSample } from '@/lib/admin-api';

const SAMPLE_SIZE = 20;

export default function AdminPlaceCatalogQaScreen() {
  const [sample, setSample] = useState<AdminSbizPlaceSample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setSample(await getSbizPlaceSample(SAMPLE_SIZE));
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : 'SBIZ_UNAVAILABLE';
      const message = code === 'ADMIN_MFA_REQUIRED'
        ? '관리자 추가 인증이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.'
        : code === 'SBIZ_NOT_CONFIGURED'
          ? 'SBIZ API 키가 서버에 설정되지 않았습니다.'
          : code === 'SBIZ_UNAVAILABLE'
            ? 'SBIZ에서 샘플을 불러오지 못했습니다. 잠시 뒤 다시 확인해 주세요.'
            : code;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>맛집 장소 데이터 QA</Text>
        <Text style={adminStyles.pageDescription}>
          소상공인시장진흥공단(SBIZ)의 서울 상가 데이터를 작은 샘플로 확인합니다. 이 화면은 조회만 하며 OnePick DB에 장소를 저장하지 않습니다.
        </Text>
      </View>

      <View style={[adminStyles.card, styles.notice]}>
        <View style={styles.noticeText}>
          <Text style={styles.noticeTitle}>안전한 1차 확인</Text>
          <Text style={adminStyles.muted}>
            관리자 MFA 세션으로 서버 함수를 호출해 서울 {SAMPLE_SIZE}개만 확인합니다. place_catalog · places · items · picks에는 쓰지 않습니다.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => void load()}
          style={[adminStyles.primaryButton, loading && styles.disabled]}
        >
          <Text style={adminStyles.primaryButtonText}>{loading ? '샘플 불러오는 중…' : `서울 ${SAMPLE_SIZE}개 샘플 불러오기`}</Text>
        </Pressable>
      </View>

      {loading && !sample ? (
        <View style={[adminStyles.card, styles.loadingCard]}>
          <ActivityIndicator />
          <Text style={adminStyles.muted}>SBIZ 응답을 확인하고 있습니다.</Text>
        </View>
      ) : null}

      {!!error ? <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text> : null}

      {sample ? (
        <>
          <View style={styles.summaryGrid}>
            <Summary label="공급자" value={sample.provider.toUpperCase()} />
            <Summary label="지역" value={sample.region} />
            <Summary label="요청" value={String(sample.requested)} />
            <Summary label="수신" value={String(sample.received)} />
          </View>

          <View style={styles.list}>
            {sample.rows.length === 0 ? (
              <View style={adminStyles.card}>
                <Text style={adminStyles.muted}>응답은 성공했지만 표시할 장소가 없습니다. 공급자 응답 구조를 확인해야 합니다.</Text>
              </View>
            ) : sample.rows.map((row, index) => {
              const address = row.payload.road_address ?? row.payload.address ?? '주소 없음';
              const branch = row.payload.branch_name ? ` · ${row.payload.branch_name}` : '';
              const coordinates = row.payload.latitude !== null && row.payload.longitude !== null
                ? `${row.payload.latitude.toFixed(5)}, ${row.payload.longitude.toFixed(5)}`
                : '좌표 없음';
              return (
                <View key={row.provider_place_id} style={[adminStyles.card, styles.rowCard]}>
                  <Text style={styles.index}>{index + 1}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.name}>{row.payload.name}{branch}</Text>
                    <Text style={styles.address}>{address}</Text>
                    <Text style={styles.meta}>
                      {row.payload.provider_category ?? '업종 없음'} · {row.payload.region_2 ?? '구 정보 없음'} · {coordinates}
                    </Text>
                    <Text style={styles.providerId}>SBIZ ID {row.provider_place_id}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={[adminStyles.card, styles.summary]}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  notice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  noticeText: { flex: 1, minWidth: 260, gap: 6 },
  noticeTitle: { color: OnePick.text, fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  loadingCard: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 10 },
  summaryGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  summary: { flexGrow: 1, flexBasis: 150, minWidth: 140 },
  summaryValue: { color: OnePick.text, fontSize: 20, fontWeight: '900' },
  summaryLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '700', marginTop: 5 },
  list: { gap: 10 },
  rowCard: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  index: { width: 24, color: OnePick.hint, fontSize: 12, fontWeight: '800', paddingTop: 2 },
  rowBody: { flex: 1, gap: 4 },
  name: { color: OnePick.text, fontSize: 15, fontWeight: '800' },
  address: { color: OnePick.muted, fontSize: 13, lineHeight: 19 },
  meta: { color: OnePick.hint, fontSize: 11, lineHeight: 17 },
  providerId: { color: OnePick.hint, fontSize: 10, lineHeight: 15 },
});
