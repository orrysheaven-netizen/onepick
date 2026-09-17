import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getReports, updateReportStatus } from '@/lib/admin-api';
import type { AdminReport, AdminReportStatus } from '@/lib/admin-api';

const FILTERS: Array<{ value: AdminReportStatus | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'open', label: '미처리' },
  { value: 'reviewing', label: '검토 중' },
  { value: 'resolved', label: '처리 완료' },
  { value: 'dismissed', label: '기각' },
];

export default function AdminReportsScreen() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminReportStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async (next = filter) => {
    setLoading(true);
    setError('');
    try {
      const result = await getReports(next);
      setReports(result);
      setSelectedId((current) => current && result.some((report) => report.id === current) ? current : result[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '신고 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load('all');
  }, []);

  const selected = reports.find((report) => report.id === selectedId) ?? null;

  const changeStatus = async (status: AdminReportStatus) => {
    if (!selected || processing) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const result = await updateReportStatus(selected.id, status);
      if (result[0]) {
        setReports((current) => current.map((report) => report.id === selected.id ? result[0] : report));
        setMessage(`신고 상태를 ${statusLabel(status)}로 변경했습니다.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '신고 상태를 변경하지 못했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>신고</Text>
        <Text style={adminStyles.pageDescription}>프로필·Pick·댓글 신고를 확인하고 처리 상태를 관리합니다.</Text>
      </View>

      <View style={adminStyles.row}>
        {FILTERS.map((item) => (
          <Pressable key={item.value} onPress={() => { setFilter(item.value); load(item.value); }} style={[styles.filter, filter === item.value && styles.filterActive]}>
            <Text style={[styles.filterText, filter === item.value && styles.filterTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.workspace}>
        <View style={[adminStyles.card, styles.listPanel]}>
          <View style={styles.panelHeader}>
            <Text style={adminStyles.sectionTitle}>신고 · {reports.length}</Text>
            {loading && <ActivityIndicator size="small" />}
          </View>
          {!loading && reports.length === 0 && <Text style={styles.empty}>현재 신고가 없습니다.</Text>}
          {reports.map((report) => (
            <Pressable key={report.id} onPress={() => setSelectedId(report.id)} style={[styles.reportRow, selectedId === report.id && styles.reportRowSelected]}>
              <View style={styles.reportBody}>
                <Text style={styles.reportTitle}>{targetLabel(report.target_type)} · {reasonLabel(report.reason)}</Text>
                <Text style={adminStyles.muted}>{formatDate(report.created_at)} · {report.id.slice(0, 8)}</Text>
              </View>
              <Text style={styles.status}>{statusLabel(report.status)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>신고 상세</Text>
          {!selected && <Text style={styles.empty}>신고를 선택해 주세요.</Text>}
          {selected && (
            <View style={styles.detailBody}>
              <View>
                <Text style={styles.detailTitle}>{targetLabel(selected.target_type)} 신고</Text>
                <Text style={[adminStyles.muted, { marginTop: 5 }]}>{reasonLabel(selected.reason)} · {statusLabel(selected.status)}</Text>
              </View>

              <View style={styles.metaBox}>
                <Meta label="대상 ID" value={selected.target_id} />
                <Meta label="대상 사용자" value={selected.target_user_id ?? '없음'} />
                <Meta label="신고 시각" value={new Date(selected.created_at).toLocaleString('ko-KR')} />
              </View>

              <View style={styles.detailsBox}>
                <Text style={adminStyles.label}>상세 내용</Text>
                <Text style={styles.detailsText}>{selected.details ?? '추가 설명 없음'}</Text>
              </View>

              <View style={adminStyles.row}>
                <Pressable disabled={processing} onPress={() => changeStatus('reviewing')} style={adminStyles.secondaryButton}>
                  <Text style={adminStyles.secondaryButtonText}>검토 중</Text>
                </Pressable>
                <Pressable disabled={processing} onPress={() => changeStatus('resolved')} style={adminStyles.primaryButton}>
                  <Text style={adminStyles.primaryButtonText}>처리 완료</Text>
                </Pressable>
                <Pressable disabled={processing} onPress={() => changeStatus('dismissed')} style={adminStyles.dangerButton}>
                  <Text style={adminStyles.dangerButtonText}>기각</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text selectable style={styles.metaValue}>{value}</Text></View>;
}

function targetLabel(value: AdminReport['target_type']) {
  return ({ profile: '프로필', pick: 'Pick', comment: '댓글' } as const)[value];
}

function reasonLabel(value: AdminReport['reason']) {
  return ({ spam: '스팸', harassment: '괴롭힘', inappropriate: '부적절한 콘텐츠', misleading: '오해 소지', other: '기타' } as const)[value];
}

function statusLabel(value: AdminReportStatus) {
  return ({ open: '미처리', reviewing: '검토 중', resolved: '처리 완료', dismissed: '기각' } as const)[value];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  filter: { minHeight: 34, justifyContent: 'center', borderRadius: 17, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  filterActive: { backgroundColor: '#111827', borderColor: '#111827' },
  filterText: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#FFFFFF' },
  workspace: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 500, minWidth: 320 },
  detailPanel: { flexGrow: 1, flexBasis: 380, minWidth: 300 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  reportRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: '#F0F1F3', borderRadius: 8 },
  reportRowSelected: { backgroundColor: '#F7F7F8' },
  reportBody: { flex: 1, minWidth: 0 },
  reportTitle: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 5 },
  status: { color: '#4B5563', fontSize: 11, fontWeight: '700', backgroundColor: '#F3F4F6', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5 },
  detailBody: { marginTop: 18, gap: 18 },
  detailTitle: { color: '#111827', fontSize: 21, fontWeight: '800' },
  metaBox: { borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  metaRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F1F3' },
  metaLabel: { width: 92, color: '#6B7280', fontSize: 12, fontWeight: '700' },
  metaValue: { flex: 1, color: '#374151', fontSize: 12 },
  detailsBox: { backgroundColor: '#F9FAFB', borderRadius: 9, padding: 14 },
  detailsText: { color: '#374151', fontSize: 13, lineHeight: 20 },
});
