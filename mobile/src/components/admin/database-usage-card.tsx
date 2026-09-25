import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getDatabaseUsage } from '@/lib/admin-api';
import type { AdminDatabaseUsage } from '@/lib/admin-api';
import { OnePick } from '@/constants/onepick';

// Supabase Free plan quotas. They are a reference line only: a paid plan has
// higher limits, so the bars read as "share of the free quota".
const DATABASE_LIMIT_BYTES = 500 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
const WARN_RATIO = 0.8;

export function DatabaseUsageCard() {
  const [usage, setUsage] = useState<AdminDatabaseUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsage(await getDatabaseUsage());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '데이터베이스 용량을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={adminStyles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={adminStyles.sectionTitle}>데이터베이스 용량</Text>
          <Text style={[adminStyles.muted, styles.hint]}>
            막대는 Supabase Free 플랜 한도(DB 500MB · 파일 1GB) 대비 사용률입니다.{usage ? ` · ${formatTime(usage.generated_at)} 기준` : ''}
          </Text>
        </View>
        <Pressable disabled={loading} onPress={() => void load()} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{loading ? '확인 중' : '다시 확인'}</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {loading && !usage && <ActivityIndicator />}

      {usage && (
        <View style={styles.body}>
          <View style={styles.gauges}>
            <Gauge label="데이터베이스" used={usage.database_bytes} limit={DATABASE_LIMIT_BYTES} />
            <Gauge label="파일 저장소 (사진 등)" used={usage.storage_bytes} limit={STORAGE_LIMIT_BYTES} />
          </View>

          <View style={styles.columns}>
            <View style={styles.column}>
              <Text style={styles.listTitle}>용량이 큰 테이블</Text>
              {usage.tables.map((table) => (
                <View key={`${table.schema}.${table.name}`} style={styles.row}>
                  <Text numberOfLines={1} style={styles.rowName}>{table.schema === 'public' ? table.name : `${table.schema}.${table.name}`}</Text>
                  <Text style={styles.rowMeta}>약 {table.row_estimate.toLocaleString('ko-KR')}행</Text>
                  <Text style={styles.rowValue}>{formatBytes(table.total_bytes)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.column}>
              <Text style={styles.listTitle}>저장소 버킷</Text>
              {usage.buckets.length === 0 && <Text style={adminStyles.muted}>버킷이 없습니다.</Text>}
              {usage.buckets.map((bucket) => (
                <View key={bucket.bucket} style={styles.row}>
                  <Text numberOfLines={1} style={styles.rowName}>{bucket.bucket}</Text>
                  <Text style={styles.rowMeta}>{bucket.objects.toLocaleString('ko-KR')}개</Text>
                  <Text style={styles.rowValue}>{formatBytes(bucket.bytes)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function Gauge({ label, used, limit }: { label: string; used: number; limit: number }) {
  const ratio = used / limit;
  const warn = ratio >= WARN_RATIO;
  return (
    <View style={styles.gauge}>
      <View style={styles.gaugeHeader}>
        <Text style={styles.gaugeLabel}>{label}</Text>
        <Text style={[styles.gaugePercent, warn && styles.warn]}>{(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%</Text>
      </View>
      <Text style={styles.gaugeValue}>{formatBytes(used)} <Text style={styles.gaugeLimit}>/ {formatBytes(limit)}</Text></Text>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
        style={styles.track}
      >
        <View style={[styles.fill, warn && styles.fillWarn, { width: `${Math.min(100, Math.max(ratio * 100, 1))}%` }]} />
      </View>
    </View>
  );
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(value));
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  headerText: { flexShrink: 1 },
  hint: { marginTop: 4, lineHeight: 18 },
  body: { gap: 18 },
  gauges: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  gauge: { flexGrow: 1, flexBasis: 260, minWidth: 220, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.sunken, borderRadius: 10, padding: 14, gap: 6 },
  gaugeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  gaugeLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  gaugePercent: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  gaugeValue: { color: OnePick.text, fontSize: 22, fontWeight: '900' },
  gaugeLimit: { color: OnePick.hint, fontSize: 13, fontWeight: '600' },
  track: { height: 10, borderRadius: 5, backgroundColor: OnePick.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: OnePick.text },
  fillWarn: { backgroundColor: OnePick.danger },
  warn: { color: OnePick.danger },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  column: { flexGrow: 1, flexBasis: 360, minWidth: 280 },
  listTitle: { color: OnePick.text, fontSize: 13, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: OnePick.sunken },
  rowName: { flex: 1, minWidth: 0, color: OnePick.text, fontSize: 13, fontWeight: '600' },
  rowMeta: { color: OnePick.hint, fontSize: 11 },
  rowValue: { width: 64, textAlign: 'right', color: OnePick.text, fontSize: 13, fontWeight: '800' },
});
