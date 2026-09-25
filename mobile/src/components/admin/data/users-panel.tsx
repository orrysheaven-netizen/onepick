import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getUserModerationHistory, getUserReports } from '@/lib/admin-api';
import type { AdminAuditLog, AdminReport } from '@/lib/admin-api';
import { getUserDirectory, setUserSuspension } from '@/lib/admin-moderation-api';
import type { AdminDirectoryUser, AdminUserDirectory, AdminUserSort, AdminUserStatusFilter } from '@/lib/admin-moderation-api';
import { reportReasonLabel, reportStatusLabel, reportTargetLabel } from '@/lib/admin/reportLabels';
import { OnePick } from '@/constants/onepick';

const FILTERS: Array<{ value: AdminUserStatusFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '정상' },
  { value: 'suspended', label: '정지' },
];

const SORTS: Array<{ value: AdminUserSort; label: string }> = [
  { value: 'created', label: '최근 가입순' },
  { value: 'activity', label: '최근 활동순' },
];

type UserHistory = { reports: AdminReport[]; moderation: AdminAuditLog[] };

export function UsersPanel() {
  const [users, setUsers] = useState<AdminDirectoryUser[]>([]);
  const [counts, setCounts] = useState<AdminUserDirectory['counts'] | null>(null);
  const [matched, setMatched] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AdminUserStatusFilter>('all');
  const [sort, setSort] = useState<AdminUserSort>('created');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<UserHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Filter, sort and search all run on the server so counts and pages stay exact.
  const load = async (next: { filter?: AdminUserStatusFilter; sort?: AdminUserSort } = {}) => {
    setLoading(true);
    setError('');
    try {
      const result = await getUserDirectory({ query, status: next.filter ?? filter, sort: next.sort ?? sort });
      setUsers(result.users);
      setCounts(result.counts);
      setMatched(result.matched);
      setSelectedId((current) => current && result.users.some((user) => user.id === current) ? current : result.users[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || users.length >= matched) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await getUserDirectory({ query, status: filter, sort, offset: users.length });
      setUsers((current) => [...current, ...result.users.filter((user) => !current.some((existing) => existing.id === user.id))]);
      setCounts(result.counts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자를 더 불러오지 못했습니다.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const selected = users.find((user) => user.id === selectedId) ?? null;

  useEffect(() => {
    setReason('');
    setError('');
    setMessage('');
    setHistory(null);
    if (!selectedId) return;
    let active = true;
    Promise.all([getUserReports(selectedId), getUserModerationHistory(selectedId)])
      .then(([reports, moderation]) => { if (active) setHistory({ reports, moderation }); })
      .catch(() => { if (active) setHistory({ reports: [], moderation: [] }); });
    return () => { active = false; };
  }, [selectedId]);

  const changeFilter = (next: AdminUserStatusFilter) => {
    setFilter(next);
    load({ filter: next });
  };

  const changeSort = (next: AdminUserSort) => {
    setSort(next);
    load({ sort: next });
  };

  const changeSuspension = async (suspended: boolean) => {
    if (!selected || processing) return;
    if (suspended && !reason.trim()) {
      setError('정지 사유를 입력해 주세요.');
      return;
    }
    if (suspended && !window.confirm(`@${selected.username} 계정을 정지하시겠습니까?`)) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const state = await setUserSuspension(selected.id, suspended, reason);
      setUsers((current) => current.map((user) => user.id === selected.id ? {
        ...user,
        moderation_status: state.status,
        suspension_reason: state.reason,
        suspended_at: state.suspended_at,
      } : user));
      setCounts((current) => current && {
        ...current,
        active: current.active + (suspended ? -1 : 1),
        suspended: current.suspended + (suspended ? 1 : -1),
      });
      setMessage(suspended ? `@${selected.username} 계정을 정지했습니다.` : `@${selected.username} 계정 정지를 해제했습니다.`);
      setReason('');
      getUserModerationHistory(selected.id)
        .then((moderation) => setHistory((current) => current && { ...current, moderation }))
        .catch(() => {});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자 제재 상태를 변경하지 못했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.summaryRow}>
        <SummaryCard label="전체 가입자" value={counts?.total} />
        <SummaryCard label="정상" value={counts?.active} />
        <SummaryCard label="정지" value={counts?.suspended} />
      </View>

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="사용자 검색"
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load()}
          placeholder="username 또는 사용자 ID"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable disabled={loading} onPress={() => load()} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>검색</Text>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <View style={adminStyles.row}>
          {FILTERS.map((item) => (
            <Chip key={item.value} label={item.label} active={filter === item.value} onPress={() => changeFilter(item.value)} />
          ))}
        </View>
        <View style={adminStyles.row}>
          {SORTS.map((item) => (
            <Chip key={item.value} label={item.label} active={sort === item.value} onPress={() => changeSort(item.value)} />
          ))}
        </View>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.workspace}>
        <View style={[adminStyles.card, styles.listPanel]}>
          <View style={styles.header}>
            <Text style={adminStyles.sectionTitle}>{FILTERS.find((item) => item.value === filter)?.label} 사용자 · {matched}</Text>
            {loading && <ActivityIndicator size="small" />}
          </View>
          {!loading && users.length === 0 && <Text style={styles.empty}>조건에 맞는 사용자가 없습니다.</Text>}
          {users.map((user) => (
            <Pressable key={user.id} onPress={() => setSelectedId(user.id)} style={[styles.userRow, selectedId === user.id && styles.userRowSelected]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{user.username.slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.userBody}>
                <View style={styles.nameRow}>
                  <Text style={styles.username}>@{user.username}</Text>
                  {user.is_admin && <Text style={styles.adminBadge}>관리자</Text>}
                  {user.open_report_count > 0 && <Text style={styles.reportBadge}>미처리 신고 {user.open_report_count}</Text>}
                </View>
                <Text style={adminStyles.muted}>
                  Pick {user.active_pick_count} · 댓글 {user.comment_count} · {sort === 'activity' ? `최근 활동 ${formatDate(user.last_active_at)}` : `가입 ${formatDate(user.created_at)}`}
                </Text>
              </View>
              <StatusBadge suspended={user.moderation_status === 'suspended'} />
            </Pressable>
          ))}
          {users.length < matched && (
            <Pressable disabled={loadingMore} onPress={loadMore} style={[adminStyles.secondaryButton, styles.loadMore]}>
              <Text style={adminStyles.secondaryButtonText}>{loadingMore ? '불러오는 중' : `더 보기 (${users.length}/${matched})`}</Text>
            </Pressable>
          )}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>사용자 상세</Text>
          {!selected && <Text style={styles.empty}>사용자를 선택해 주세요.</Text>}
          {selected && (
            <View style={styles.detailBody}>
              <View style={styles.detailHeader}>
                <View style={styles.userBody}>
                  <Text style={styles.detailName}>@{selected.username}</Text>
                  <Text style={[adminStyles.muted, { marginTop: 5 }]}>{selected.onboarding_completed ? '온보딩 완료' : '온보딩 미완료'} · {new Date(selected.created_at).toLocaleDateString('ko-KR')} 가입</Text>
                </View>
                <Link href={{ pathname: '/u/[username]', params: { username: selected.username } }} target="_blank" style={styles.profileLink}>
                  공개 프로필 ↗
                </Link>
              </View>

              <View style={styles.statRow}>
                <Stat label="활성 Pick" value={selected.active_pick_count} />
                <Stat label="댓글" value={selected.comment_count} />
                <Stat label="받은 신고" value={selected.report_count} />
                <Stat label="미처리 신고" value={selected.open_report_count} alert={selected.open_report_count > 0} />
              </View>

              <View style={styles.metaBox}>
                <Meta label="사용자 ID" value={selected.id} />
                <Meta label="최근 활동" value={new Date(selected.last_active_at).toLocaleString('ko-KR')} />
                <Meta label="계정 상태" value={selected.moderation_status === 'suspended' ? '정지' : '정상'} />
                {selected.suspended_at && <Meta label="정지 시각" value={new Date(selected.suspended_at).toLocaleString('ko-KR')} />}
              </View>

              {selected.is_admin ? (
                <Text style={styles.note}>관리자 계정은 어드민에서 정지할 수 없습니다.</Text>
              ) : selected.moderation_status === 'suspended' ? (
                <View style={styles.moderationBox}>
                  <Text style={adminStyles.label}>정지 사유</Text>
                  <Text style={styles.reasonText}>{selected.suspension_reason ?? '사유 없음'}</Text>
                  <Pressable disabled={processing} onPress={() => changeSuspension(false)} style={[adminStyles.primaryButton, processing && styles.disabled]}>
                    <Text style={adminStyles.primaryButtonText}>{processing ? '처리 중' : '정지 해제'}</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.moderationBox}>
                  <Text style={adminStyles.label}>정지 사유</Text>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="스팸, 반복적인 정책 위반 등"
                    multiline
                    maxLength={500}
                    style={[adminStyles.input, styles.reasonInput]}
                  />
                  <Text style={adminStyles.muted}>{reason.length}/500</Text>
                  <Pressable disabled={processing} onPress={() => changeSuspension(true)} style={[adminStyles.dangerButton, processing && styles.disabled]}>
                    <Text style={adminStyles.dangerButtonText}>{processing ? '처리 중' : '사용자 정지'}</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.historyBox}>
                <View style={styles.header}>
                  <Text style={styles.historyTitle}>받은 신고</Text>
                  <Link href="/admin/data?tab=reports" style={styles.historyLink}>신고 탭에서 처리</Link>
                </View>
                {!history && <ActivityIndicator size="small" />}
                {history?.reports.length === 0 && <Text style={styles.historyEmpty}>받은 신고가 없습니다.</Text>}
                {history?.reports.map((report) => (
                  <View key={report.id} style={styles.historyRow}>
                    <Text style={styles.historyMain}>{reportTargetLabel(report.target_type)} · {reportReasonLabel(report.reason)}</Text>
                    <Text style={adminStyles.muted}>{reportStatusLabel(report.status)} · {formatDate(report.created_at)}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.historyBox}>
                <Text style={styles.historyTitle}>정지 이력</Text>
                {!history && <ActivityIndicator size="small" />}
                {history?.moderation.length === 0 && <Text style={styles.historyEmpty}>정지·해제 기록이 없습니다.</Text>}
                {history?.moderation.map((entry) => (
                  <View key={entry.id} style={styles.historyRow}>
                    <Text style={styles.historyMain}>
                      {entry.summary.status === 'suspended' ? '정지' : '정지 해제'}{typeof entry.summary.reason === 'string' ? ` · ${entry.summary.reason}` : ''}
                    </Text>
                    <Text style={adminStyles.muted}>{formatDate(entry.created_at)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value ?? '–'}</Text>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterButton, active && styles.filterButtonActive]}
    >
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.statValue, alert && styles.statValueAlert]}>{value}</Text>
    </View>
  );
}

function StatusBadge({ suspended }: { suspended: boolean }) {
  return <Text style={[styles.statusBadge, suspended && styles.statusBadgeSuspended]}>{suspended ? '정지' : '정상'}</Text>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text selectable style={styles.metaValue}>{value}</Text></View>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  summaryRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  summaryCard: { minWidth: 108, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  summaryLabel: { color: OnePick.muted, fontSize: 11, fontWeight: '600' },
  summaryValue: { marginTop: 4, color: OnePick.text, fontSize: 20, fontWeight: '800' },
  toolbar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 520 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  filterButton: { minHeight: 34, justifyContent: 'center', borderRadius: 17, paddingHorizontal: 12, backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  filterButtonActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  filterText: { color: OnePick.muted, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: OnePick.onAccent },
  workspace: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 520, minWidth: 320 },
  detailPanel: { flexGrow: 1, flexBasis: 380, minWidth: 300 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  empty: { color: OnePick.hint, fontSize: 13, paddingVertical: 24 },
  loadMore: { marginTop: 12, alignSelf: 'center' },
  userRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: OnePick.sunken, borderRadius: 8 },
  userRowSelected: { backgroundColor: OnePick.sunken },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: OnePick.sunken, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: OnePick.muted, fontSize: 14, fontWeight: '800' },
  userBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4, flexWrap: 'wrap' },
  username: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  adminBadge: { color: OnePick.muted, backgroundColor: OnePick.sunken, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, fontWeight: '700' },
  reportBadge: { color: OnePick.danger, backgroundColor: OnePick.dangerSoft, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, fontWeight: '700' },
  statusBadge: { color: OnePick.success, backgroundColor: OnePick.successSoft, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  statusBadgeSuspended: { color: OnePick.danger, backgroundColor: OnePick.dangerSoft },
  detailBody: { marginTop: 18, gap: 18 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailName: { color: OnePick.text, fontSize: 21, fontWeight: '800' },
  profileLink: { color: OnePick.accent, fontSize: 12, fontWeight: '700', paddingTop: 6 },
  statRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  stat: { flexGrow: 1, flexBasis: 80, backgroundColor: OnePick.sunken, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  statValue: { marginTop: 3, color: OnePick.text, fontSize: 17, fontWeight: '800' },
  statValueAlert: { color: OnePick.danger },
  metaBox: { borderTopWidth: 1, borderTopColor: OnePick.sunken },
  metaRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: OnePick.sunken },
  metaLabel: { width: 82, color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  metaValue: { flex: 1, color: OnePick.muted, fontSize: 12 },
  moderationBox: { gap: 10 },
  reasonInput: { minHeight: 88, textAlignVertical: 'top' },
  reasonText: { color: OnePick.muted, fontSize: 13, lineHeight: 20, backgroundColor: OnePick.sunken, borderRadius: 8, padding: 12 },
  note: { color: OnePick.muted, fontSize: 12, lineHeight: 19, backgroundColor: OnePick.sunken, borderRadius: 8, padding: 12 },
  historyBox: { gap: 6, borderTopWidth: 1, borderTopColor: OnePick.sunken, paddingTop: 14 },
  historyTitle: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  historyLink: { color: OnePick.accent, fontSize: 12, fontWeight: '700' },
  historyEmpty: { color: OnePick.hint, fontSize: 12 },
  historyRow: { gap: 2, paddingVertical: 6 },
  historyMain: { color: OnePick.text, fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
