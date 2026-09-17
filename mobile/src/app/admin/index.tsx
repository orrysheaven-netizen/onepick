import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getAuditLogs, getDashboardMetrics } from '@/lib/admin-api';
import type { AdminAuditLog, AdminDashboardMetrics } from '@/lib/admin-api';

const EMPTY_METRICS: AdminDashboardMetrics = {
  users_total: 0,
  categories_total: 0,
  categories_open: 0,
  items_total: 0,
  items_pending: 0,
  items_active: 0,
  picks_total: 0,
  picks_active: 0,
  reports_open: 0,
};

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextMetrics, nextLogs] = await Promise.all([getDashboardMetrics(), getAuditLogs()]);
      setMetrics(nextMetrics);
      setLogs(nextLogs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '대시보드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const cards = [
    ['전체 사용자', metrics.users_total],
    ['전체 카테고리', metrics.categories_total],
    ['전체 상품', metrics.items_total],
    ['검수 대기', metrics.items_pending],
    ['활성 Pick', metrics.picks_active],
    ['미처리 신고', metrics.reports_open],
  ] as const;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={adminStyles.pageTitle}>대시보드</Text>
          <Text style={adminStyles.pageDescription}>원픽의 현재 운영 상태를 한눈에 확인합니다.</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{loading ? '불러오는 중' : '새로고침'}</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}

      <View style={styles.metrics}>
        {cards.map(([label, value]) => (
          <View key={label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={styles.metricValue}>{loading ? '—' : value.toLocaleString('ko-KR')}</Text>
          </View>
        ))}
      </View>

      <View style={adminStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={adminStyles.sectionTitle}>최근 운영 기록</Text>
          {loading && <ActivityIndicator size="small" />}
        </View>
        {!loading && logs.length === 0 && <Text style={styles.empty}>아직 운영 기록이 없습니다.</Text>}
        {logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.logBody}>
              <Text style={styles.logTitle}>{labelForEntity(log.entity_type)} · {labelForAction(log.action)}</Text>
              <Text style={adminStyles.muted} numberOfLines={1}>{summaryText(log.summary)}</Text>
            </View>
            <Text style={styles.logDate}>{formatDate(log.created_at)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function labelForEntity(value: string) {
  return ({ category: '카테고리', item: '상품', brand: '브랜드', content_report: '신고' } as Record<string, string>)[value] ?? value;
}

function labelForAction(value: string) {
  return ({ insert: '추가', update: '수정', delete: '삭제' } as Record<string, string>)[value] ?? value;
}

function summaryText(summary: Record<string, unknown>) {
  const name = summary.name ?? summary.item_name ?? summary.category_name;
  if (typeof name === 'string') return name;
  const entries = Object.entries(summary).slice(0, 2).map(([key, value]) => `${key}: ${String(value)}`);
  return entries.join(' · ') || '변경 내용 기록';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 24 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { minWidth: 165, flexGrow: 1, flexBasis: 180, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 18 },
  metricLabel: { color: '#6B7280', fontSize: 13, fontWeight: '600' },
  metricValue: { marginTop: 18, color: '#111827', fontSize: 29, fontWeight: '800', letterSpacing: -0.7 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  logRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: '#F1F3F5', paddingVertical: 12 },
  logBody: { flex: 1, minWidth: 0 },
  logTitle: { color: '#1F2937', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  logDate: { color: '#9CA3AF', fontSize: 12 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
});
