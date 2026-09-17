import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getAuditLogs } from '@/lib/admin-api';
import type { AdminAuditLog } from '@/lib/admin-api';

export default function AdminAuditScreen() {
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setLogs(await getAuditLogs(100));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '운영 기록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={adminStyles.pageTitle}>운영 기록</Text>
          <Text style={adminStyles.pageDescription}>카테고리·브랜드·상품·신고에 대한 최근 관리자 변경 기록을 확인합니다.</Text>
        </View>
        <Pressable disabled={loading} onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}

      <View style={adminStyles.card}>
        <View style={styles.sectionHeader}>
          <Text style={adminStyles.sectionTitle}>최근 기록 · {logs.length}</Text>
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
      </View>
    </View>
  );
}

function entityLabel(value: string) {
  return ({ category: '카테고리', brand: '브랜드', item: '상품', content_report: '신고' } as Record<string, string>)[value] ?? value;
}

function actionLabel(value: string) {
  return ({ insert: '추가', update: '수정', delete: '삭제' } as Record<string, string>)[value] ?? value;
}

function summaryText(summary: Record<string, unknown>) {
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
  logRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  actionBadge: { minWidth: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5 },
  actionText: { color: '#4B5563', fontSize: 11, fontWeight: '700' },
  logBody: { flex: 1, minWidth: 0 },
  logTitle: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 5 },
  date: { color: '#9CA3AF', fontSize: 11 },
});
