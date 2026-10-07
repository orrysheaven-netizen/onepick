import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { ADMIN_PAGE_SIZE, getReports, updateReportStatus } from '@/lib/admin-api';
import { getUserModeration, setUserSuspension } from '@/lib/admin-moderation-api';
import type { AdminReport, AdminReportStatus } from '@/lib/admin-api';
import type { UserModeration } from '@/lib/admin-moderation-api';
import { OnePick } from '@/constants/onepick';
import { reportReasonLabel, reportStatusLabel, reportTargetLabel } from '@/lib/admin/reportLabels';

const FILTERS: Array<{ value: AdminReportStatus | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'open', label: '미처리' },
  { value: 'reviewing', label: '검토 중' },
  { value: 'resolved', label: '처리 완료' },
  { value: 'dismissed', label: '기각' },
];

export function ReportsPanel() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdminReportStatus | 'all'>('all');
  const [moderation, setModeration] = useState<UserModeration | null>(null);
  const [suspensionReason, setSuspensionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [moderationLoading, setModerationLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async (next = filter) => {
    setLoading(true);
    setError('');
    try {
      const result = await getReports(next);
      setReports(result);
      setHasMore(result.length === ADMIN_PAGE_SIZE);
      setSelectedId((current) => current && result.some((report) => report.id === current) ? current : result[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '신고 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getReports(filter, reports.length);
      setReports((current) => [...current, ...result]);
      setHasMore(result.length === ADMIN_PAGE_SIZE);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '신고 목록을 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load('all');
  }, []);

  const selected = reports.find((report) => report.id === selectedId) ?? null;

  useEffect(() => {
    const targetUserId = selected?.target_user_id;
    setModeration(null);
    setSuspensionReason('');
    setError('');
    setMessage('');
    if (!targetUserId) return;

    setModerationLoading(true);
    getUserModeration(targetUserId)
      .then((state) => {
        setModeration(state);
        setSuspensionReason(state.reason ?? '');
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : '대상 사용자 상태를 불러오지 못했습니다.'))
      .finally(() => setModerationLoading(false));
  }, [selectedId]);

  const changeStatus = async (status: AdminReportStatus) => {
    if (!selected || processing) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const result = await updateReportStatus(selected.id, status);
      if (result[0]) {
        setReports((current) => current.map((report) => report.id === selected.id ? result[0] : report));
        setMessage(`신고 상태를 ${reportStatusLabel(status)}로 변경했습니다.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '신고 상태를 변경하지 못했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  const changeUserSuspension = async (suspended: boolean) => {
    if (!selected?.target_user_id || !moderation || processing) return;
    if (suspended && !suspensionReason.trim()) {
      setError('정지 사유를 입력해 주세요.');
      return;
    }
    if (suspended && !window.confirm('신고 대상 사용자를 정지하시겠습니까?')) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const next = await setUserSuspension(selected.target_user_id, suspended, suspensionReason);
      setModeration({ ...next, is_admin: moderation.is_admin });
      setSuspensionReason(next.reason ?? '');
      setMessage(suspended ? '신고 대상 사용자를 정지했습니다.' : '신고 대상 사용자의 정지를 해제했습니다.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자 제재 상태를 변경하지 못했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.page}>
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
                <Text style={styles.reportTitle}>{reportTargetLabel(report.target_type)} · {reportReasonLabel(report.reason)}</Text>
                <Text style={adminStyles.muted}>{formatDate(report.created_at)} · {report.id.slice(0, 8)}</Text>
              </View>
              <Text style={styles.status}>{reportStatusLabel(report.status)}</Text>
            </Pressable>
          ))}
          {hasMore && (
            <Pressable disabled={loadingMore} onPress={loadMore} style={[adminStyles.secondaryButton, styles.loadMore]}>
              <Text style={adminStyles.secondaryButtonText}>{loadingMore ? '불러오는 중' : '더 보기'}</Text>
            </Pressable>
          )}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>신고 상세</Text>
          {!selected && <Text style={styles.empty}>신고를 선택해 주세요.</Text>}
          {selected && (
            <View style={styles.detailBody}>
              <View>
                <Text style={styles.detailTitle}>{reportTargetLabel(selected.target_type)} 신고</Text>
                <Text style={[adminStyles.muted, { marginTop: 5 }]}>{reportReasonLabel(selected.reason)} · {reportStatusLabel(selected.status)}</Text>
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

              {selected.target_user_id && (
                <View style={styles.moderationBox}>
                  <View style={styles.moderationHeader}>
                    <Text style={adminStyles.sectionTitle}>대상 사용자 제재</Text>
                    {moderationLoading && <ActivityIndicator size="small" />}
                  </View>
                  {moderation && (
                    moderation.is_admin ? (
                      <Text style={styles.note}>관리자 계정은 이 화면에서 정지할 수 없습니다.</Text>
                    ) : moderation.status === 'suspended' ? (
                      <>
                        <Text style={styles.suspendedBadge}>정지 중</Text>
                        <Text style={styles.reasonText}>{moderation.reason ?? '사유 없음'}</Text>
                        {moderation.suspended_at && <Text style={adminStyles.muted}>{new Date(moderation.suspended_at).toLocaleString('ko-KR')} 정지</Text>}
                        <Pressable disabled={processing} onPress={() => changeUserSuspension(false)} style={[adminStyles.secondaryButton, processing && styles.disabled]}>
                          <Text style={adminStyles.secondaryButtonText}>정지 해제</Text>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <TextInput
                          value={suspensionReason}
                          onChangeText={setSuspensionReason}
                          placeholder="정지 사유 입력"
                          multiline
                          maxLength={500}
                          style={[adminStyles.input, styles.reasonInput]}
                        />
                        <Text style={adminStyles.muted}>{suspensionReason.length}/500</Text>
                        <Pressable disabled={processing} onPress={() => changeUserSuspension(true)} style={[adminStyles.dangerButton, processing && styles.disabled]}>
                          <Text style={adminStyles.dangerButtonText}>대상 사용자 정지</Text>
                        </Pressable>
                      </>
                    )
                  )}
                </View>
              )}

              <View style={adminStyles.row}>
                <Pressable disabled={processing} onPress={() => changeStatus('reviewing')} style={adminStyles.secondaryButton}>
                  <Text style={adminStyles.secondaryButtonText}>검토 중</Text>
                </Pressable>
                <Pressable disabled={processing} onPress={() => changeStatus('resolved')} style={adminStyles.primaryButton}>
                  <Text style={adminStyles.primaryButtonText}>처리 완료로 표시</Text>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  filter: { minHeight: 34, justifyContent: 'center', borderRadius: 17, paddingHorizontal: 12, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  filterActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  filterText: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: OnePick.onAccent },
  workspace: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 500, minWidth: 320 },
  detailPanel: { flexGrow: 1, flexBasis: 380, minWidth: 300 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 24 },
  loadMore: { marginTop: 12, alignSelf: 'center' },
  reportRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: OnePick.sunken, borderRadius: 8 },
  reportRowSelected: { backgroundColor: OnePick.sunken },
  reportBody: { flex: 1, minWidth: 0 },
  reportTitle: { color: OnePick.text, fontSize: 14, fontWeight: '700', marginBottom: 5 },
  status: { color: OnePick.muted, fontSize: 11, fontWeight: '700', backgroundColor: OnePick.sunken, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5 },
  detailBody: { marginTop: 18, gap: 18 },
  detailTitle: { color: OnePick.text, fontSize: 21, fontWeight: '800' },
  metaBox: { borderTopWidth: 1, borderTopColor: OnePick.sunken },
  metaRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: OnePick.sunken },
  metaLabel: { width: 92, color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  metaValue: { flex: 1, color: OnePick.muted, fontSize: 12 },
  detailsBox: { backgroundColor: OnePick.sunken, borderRadius: 9, padding: 14 },
  detailsText: { color: OnePick.muted, fontSize: 13, lineHeight: 20 },
  moderationBox: { borderTopWidth: 1, borderTopColor: OnePick.sunken, paddingTop: 16, gap: 10 },
  moderationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reasonInput: { minHeight: 86, textAlignVertical: 'top' },
  reasonText: { color: OnePick.muted, fontSize: 13, lineHeight: 20, backgroundColor: OnePick.sunken, borderRadius: 8, padding: 12 },
  suspendedBadge: { alignSelf: 'flex-start', color: OnePick.danger, backgroundColor: OnePick.dangerSoft, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  note: { color: OnePick.muted, fontSize: 12, lineHeight: 19, backgroundColor: OnePick.sunken, borderRadius: 8, padding: 12 },
  disabled: { opacity: 0.5 },
});
