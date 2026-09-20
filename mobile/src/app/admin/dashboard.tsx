import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getAuditLogs, getDashboardMetrics } from '@/lib/admin-api';
import type { AdminAuditLog, AdminDashboardMetrics } from '@/lib/admin-api';

type DashboardMetrics = AdminDashboardMetrics & { users_suspended?: number };

type RoutePath = '/admin/pending' | '/admin/reports' | '/admin/users' | '/admin/items' | '/admin/audit';

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextMetrics, nextLogs] = await Promise.all([
        getDashboardMetrics(),
        getAuditLogs(30),
      ]);
      setMetrics(nextMetrics as DashboardMetrics);
      setLogs(nextLogs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 현황을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const moderationLogs = useMemo(
    () => logs.filter((log) => log.entity_type === 'user_moderation').slice(0, 6),
    [logs],
  );

  const go = (path: RoutePath) => router.push(path);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={adminStyles.pageTitle}>대시보드</Text>
          <Text style={adminStyles.pageDescription}>처리가 필요한 운영 항목과 서비스 핵심 지표를 한 화면에서 확인합니다.</Text>
        </View>
        <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>{loading ? '새로고침 중' : '새로고침'}</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}

      {loading && !metrics ? (
        <View style={[adminStyles.card, styles.loadingCard]}>
          <ActivityIndicator />
          <Text style={adminStyles.muted}>운영 현황을 확인하고 있습니다.</Text>
        </View>
      ) : metrics ? (
        <>
          <Text style={styles.eyebrow}>처리 필요</Text>
          <View style={styles.metricGrid}>
            <MetricCard label="검수 대기" value={metrics.items_pending} detail="등록 요청 확인" attention={metrics.items_pending > 0} onPress={() => go('/admin/pending')} />
            <MetricCard label="미처리 신고" value={metrics.reports_open} detail="미처리 + 검토 중" attention={metrics.reports_open > 0} onPress={() => go('/admin/reports')} />
            <MetricCard label="정지 사용자" value={metrics.users_suspended ?? 0} detail="현재 제재 계정" attention={(metrics.users_suspended ?? 0) > 0} onPress={() => go('/admin/users')} />
          </View>

          <Text style={styles.eyebrow}>서비스 현황</Text>
          <View style={styles.metricGrid}>
            <MetricCard label="전체 사용자" value={metrics.users_total} detail="가입 프로필" onPress={() => go('/admin/users')} />
            <MetricCard label="활성 상품" value={metrics.items_active} detail={`전체 ${metrics.items_total}개`} onPress={() => go('/admin/items')} />
            <MetricCard label="활성 원픽" value={metrics.picks_active} detail={`누적 ${metrics.picks_total}개`} />
          </View>

          <View style={styles.columns}>
            <View style={[adminStyles.card, styles.column]}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={adminStyles.sectionTitle}>최근 사용자 제재</Text>
                  <Text style={[adminStyles.muted, styles.sectionDescription]}>정지·해제 변경 이력</Text>
                </View>
                <Pressable onPress={() => go('/admin/users')}><Text style={styles.textLink}>사용자 관리</Text></Pressable>
              </View>
              {moderationLogs.length === 0 ? (
                <Text style={styles.empty}>최근 사용자 제재 기록이 없습니다.</Text>
              ) : moderationLogs.map((log) => <AuditRow key={log.id} log={log} />)}
            </View>

            <View style={[adminStyles.card, styles.column]}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={adminStyles.sectionTitle}>최근 운영 기록</Text>
                  <Text style={[adminStyles.muted, styles.sectionDescription]}>관리자 변경 내역</Text>
                </View>
                <Pressable onPress={() => go('/admin/audit')}><Text style={styles.textLink}>전체 보기</Text></Pressable>
              </View>
              {logs.length === 0 ? (
                <Text style={styles.empty}>운영 기록이 없습니다.</Text>
              ) : logs.slice(0, 7).map((log) => <AuditRow key={log.id} log={log} />)}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function MetricCard({ label, value, detail, attention = false, onPress }: { label: string; value: number; detail: string; attention?: boolean; onPress?: () => void }) {
  const content = (
    <>
      <Text style={[styles.metricValue, attention && styles.metricValueAttention]}>{value.toLocaleString('ko-KR')}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricDetail}>{detail}{onPress ? '  →' : ''}</Text>
    </>
  );

  if (!onPress) return <View style={[adminStyles.card, styles.metricCard]}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [adminStyles.card, styles.metricCard, styles.metricCardInteractive, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function AuditRow({ log }: { log: AdminAuditLog }) {
  return (
    <View style={styles.auditRow}>
      <View style={styles.auditBody}>
        <Text style={styles.auditTitle}>{entityLabel(log.entity_type)} · {actionLabel(log.action)}</Text>
        <Text numberOfLines={2} style={adminStyles.muted}>{summaryText(log.summary)}</Text>
      </View>
      <Text style={styles.auditDate}>{formatDate(log.created_at)}</Text>
    </View>
  );
}

function entityLabel(value: string) {
  return ({ category: '카테고리', brand: '브랜드', item: '상품', content_report: '신고', user_moderation: '사용자 제재' } as Record<string, string>)[value] ?? value;
}

function actionLabel(value: string) {
  return ({ insert: '추가', update: '변경', delete: '삭제' } as Record<string, string>)[value] ?? value;
}

function summaryText(summary: Record<string, unknown>) {
  const preferred = ['username', 'status', 'reason', 'name'];
  const entries = preferred
    .filter((key) => summary[key] !== undefined)
    .map((key) => [key, summary[key]] as const)
    .slice(0, 3);
  const fallback = Object.entries(summary).slice(0, 3);
  const values = entries.length ? entries : fallback;
  if (!values.length) return '변경 내용 기록';
  return values.map(([key, value]) => `${summaryLabel(key)}: ${formatValue(value)}`).join(' · ');
}

function summaryLabel(key: string) {
  return ({ username: '사용자', status: '상태', reason: '사유', name: '이름' } as Record<string, string>)[key] ?? key;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  loadingCard: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
  eyebrow: { color: '#6B7280', fontSize: 12, fontWeight: '800', marginTop: 2 },
  metricGrid: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  metricCard: { flexGrow: 1, flexBasis: 220, minWidth: 190, minHeight: 132, justifyContent: 'center' },
  metricCardInteractive: { cursor: 'pointer' as never },
  metricValue: { color: '#111827', fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  metricValueAttention: { color: '#9F2D2D' },
  metricLabel: { color: '#374151', fontSize: 14, fontWeight: '800', marginTop: 8 },
  metricDetail: { color: '#9CA3AF', fontSize: 11, marginTop: 5 },
  pressed: { opacity: 0.72 },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 2 },
  column: { flexGrow: 1, flexBasis: 430, minWidth: 300 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 8 },
  sectionDescription: { marginTop: 4 },
  textLink: { color: '#374151', fontSize: 12, fontWeight: '700' },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  auditRow: { minHeight: 66, flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingVertical: 11 },
  auditBody: { flex: 1, minWidth: 0 },
  auditTitle: { color: '#111827', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  auditDate: { color: '#9CA3AF', fontSize: 10 },
});
