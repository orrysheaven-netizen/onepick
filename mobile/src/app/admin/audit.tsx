import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getAuditLogs, getClientErrorEvents } from '@/lib/admin-api';
import type { AdminAuditLog, AdminClientErrorEvent } from '@/lib/admin-api';

const LOG_PAGE_SIZE = 100;

export default function AdminAuditScreen() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [errorEvents, setErrorEvents] = useState<AdminClientErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextLogs, nextErrorEvents] = await Promise.all([getAuditLogs(LOG_PAGE_SIZE), getClientErrorEvents(50)]);
      setLogs(nextLogs);
      setHasMore(nextLogs.length === LOG_PAGE_SIZE);
      setErrorEvents(nextErrorEvents);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreLogs = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getAuditLogs(LOG_PAGE_SIZE, logs.length);
      setLogs((current) => [...current, ...result]);
      setHasMore(result.length === LOG_PAGE_SIZE);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 기록을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const errorSummary = summarizeErrors(errorEvents);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={adminStyles.pageTitle}>운영 기록</Text>
          <Text style={adminStyles.pageDescription}>카테고리·브랜드·상품·신고·사용자 제재에 대한 관리자 변경 기록과 앱 오류 발생 현황을 확인합니다.</Text>
        </View>
        <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}

      <View style={adminStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={adminStyles.sectionTitle}>최근 관리자 변경 · {logs.length}</Text>
          {loading && <ActivityIndicator size="small" />}
        </View>
        {!loading && logs.length === 0 && <Text style={styles.empty}>운영 기록이 없습니다.</Text>}
        {logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={styles.actionBadge}><Text style={styles.actionText}>{actionLabel(log.action)}</Text></View>
            <View style={styles.logBody}>
              <Text style={styles.logTitle}>{entityLabel(log.entity_type)}</Text>
              <Text style={adminStyles.muted} numberOfLines={2}>{summaryText(log.summary)}</Text>
            </View>
            <Text style={styles.date}>{new Date(log.created_at).toLocaleString('ko-KR')}</Text>
          </View>
        ))}
        {hasMore && (
          <Pressable disabled={loadingMore} onPress={loadMoreLogs} style={[adminStyles.secondaryButton, styles.loadMore]}>
            <Text style={adminStyles.secondaryButtonText}>{loadingMore ? '불러오는 중' : '더 보기'}</Text>
          </Pressable>
        )}
      </View>

      <View style={adminStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={adminStyles.sectionTitle}>앱 오류 · {errorEvents.length}건</Text>
          {loading && <ActivityIndicator size="small" />}
        </View>
        {!loading && errorSummary.length === 0 && <Text style={styles.empty}>기록된 앱 오류가 없습니다.</Text>}
        {errorSummary.map((item) => (
          <View key={item.code} style={styles.errorSummaryRow}>
            <Text style={styles.errorCode}>{item.code}</Text>
            <Text style={styles.errorCount}>{item.count}건</Text>
          </View>
        ))}
        {errorEvents.slice(0, 20).map((event) => (
          <View key={event.id} style={styles.logRow}>
            <View style={styles.logBody}>
              <Text style={styles.logTitle}>{event.error_code}</Text>
              <Text style={adminStyles.muted}>{event.context} · {event.platform ?? 'unknown'} · v{event.app_version ?? '?'}</Text>
            </View>
            <Text style={styles.date}>{new Date(event.created_at).toLocaleString('ko-KR')}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function summarizeErrors(events: AdminClientErrorEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.error_code, (counts.get(event.error_code) ?? 0) + 1);
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function entityLabel(value: string) {
  return ({ category: '카테고리', brand: '브랜드', item: '상품', content_report: '신고', user_moderation: '사용자 제재' } as Record<string, string>)[value] ?? value;
}

function actionLabel(value: string) {
  return ({ insert: '추가', update: '수정', delete: '삭제' } as Record<string, string>)[value] ?? value;
}

function summaryText(summary: Record<string, unknown>) {
  if (typeof summary.status === 'string' && typeof summary.user_id === 'string') {
    const status = summary.status === 'suspended' ? '정지' : summary.status === 'active' ? '정상' : summary.status;
    const reason = typeof summary.reason === 'string' ? ` · 사유: ${summary.reason}` : '';
    return `사용자 ${summary.user_id} · 상태: ${status}${reason}`;
  }
  const entries = Object.entries(summary).slice(0, 4);
  if (entries.length === 0) return '변경 내용 기록';
  return entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join(' · ');
}

function formatValue(value: unknown) {
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  loadMore: { marginTop: 12, alignSelf: 'center' },
  logRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  actionBadge: { minWidth: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5 },
  actionText: { color: '#4B5563', fontSize: 11, fontWeight: '700' },
  logBody: { flex: 1, minWidth: 0 },
  logTitle: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 5 },
  date: { color: '#9CA3AF', fontSize: 11 },
  errorSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0F1F3', paddingVertical: 10 },
  errorCode: { color: '#111827', fontSize: 13, fontWeight: '700' },
  errorCount: { color: '#4945ED', fontSize: 11, fontWeight: '800', backgroundColor: '#EFEEFF', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
});
