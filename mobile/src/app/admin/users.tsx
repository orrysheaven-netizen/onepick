import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getModeratedUsers, setUserSuspension } from '@/lib/admin-moderation-api';
import type { ModeratedAdminUser } from '@/lib/admin-moderation-api';

type UserFilter = 'all' | 'active' | 'suspended';

const FILTERS: Array<{ value: UserFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '정상' },
  { value: 'suspended', label: '정지' },
];

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<ModeratedAdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getModeratedUsers(query);
      setUsers(result);
      const visible = filter === 'all' ? result : result.filter((user) => user.moderation_status === filter);
      setSelectedId((current) => current && visible.some((user) => user.id === current) ? current : visible[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activeCount = users.filter((user) => user.moderation_status === 'active').length;
  const suspendedCount = users.length - activeCount;
  const visibleUsers = filter === 'all' ? users : users.filter((user) => user.moderation_status === filter);
  const selected = users.find((user) => user.id === selectedId) ?? null;

  useEffect(() => {
    setReason(selected?.suspension_reason ?? '');
    setError('');
    setMessage('');
  }, [selectedId]);

  const changeFilter = (next: UserFilter) => {
    setFilter(next);
    const nextUsers = next === 'all' ? users : users.filter((user) => user.moderation_status === next);
    setSelectedId((current) => current && nextUsers.some((user) => user.id === current) ? current : nextUsers[0]?.id ?? null);
  };

  const changeSuspension = async (suspended: boolean) => {
    if (!selected || processing) return;
    if (suspended && !reason.trim()) {
      setError('정지 사유를 입력해 주세요.');
      return;
    }
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const state = await setUserSuspension(selected.id, suspended, reason);
      const nextStatus = state.status;
      setUsers((current) => current.map((user) => user.id === selected.id ? {
        ...user,
        moderation_status: nextStatus,
        suspension_reason: state.reason,
        suspended_at: state.suspended_at,
      } : user));
      setMessage(suspended ? `@${selected.username} 계정을 정지했습니다.` : `@${selected.username} 계정 정지를 해제했습니다.`);
      if (!suspended) setReason('');

      if (filter !== 'all' && filter !== nextStatus) {
        const remaining = users.filter((user) => user.id !== selected.id && user.moderation_status === filter);
        setSelectedId(remaining[0]?.id ?? null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자 제재 상태를 변경하지 못했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>사용자</Text>
        <Text style={adminStyles.pageDescription}>사용자를 조회하고 계정을 정지하거나 해제합니다. 정지된 사용자의 공개 콘텐츠는 숨겨지고 새 Pick·댓글 작성이 차단됩니다.</Text>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard label="전체" value={users.length} />
        <SummaryCard label="정상" value={activeCount} />
        <SummaryCard label="정지" value={suspendedCount} />
      </View>

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="사용자 검색"
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={load}
          placeholder="username 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>검색</Text>
        </Pressable>
      </View>

      <View style={adminStyles.row}>
        {FILTERS.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: filter === item.value }}
            key={item.value}
            onPress={() => changeFilter(item.value)}
            style={[styles.filterButton, filter === item.value && styles.filterButtonActive]}
          >
            <Text style={[styles.filterText, filter === item.value && styles.filterTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}
      {!!message && <Text accessibilityLiveRegion="polite" style={adminStyles.success}>{message}</Text>}

      <View style={styles.workspace}>
        <View style={[adminStyles.card, styles.listPanel]}>
          <View style={styles.header}>
            <Text style={adminStyles.sectionTitle}>{FILTERS.find((item) => item.value === filter)?.label} 사용자 · {visibleUsers.length}</Text>
            {loading && <ActivityIndicator size="small" />}
          </View>
          {!loading && visibleUsers.length === 0 && <Text style={styles.empty}>조건에 맞는 사용자가 없습니다.</Text>}
          {visibleUsers.map((user) => (
            <Pressable key={user.id} onPress={() => setSelectedId(user.id)} style={[styles.userRow, selectedId === user.id && styles.userRowSelected]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{user.username.slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.userBody}>
                <View style={styles.nameRow}>
                  <Text style={styles.username}>@{user.username}</Text>
                  {user.is_admin && <Text style={styles.adminBadge}>관리자</Text>}
                </View>
                <Text selectable style={adminStyles.muted}>{user.id}</Text>
              </View>
              <StatusBadge suspended={user.moderation_status === 'suspended'} />
            </Pressable>
          ))}
        </View>

        <View style={[adminStyles.card, styles.detailPanel]}>
          <Text style={adminStyles.sectionTitle}>사용자 상세</Text>
          {!selected && <Text style={styles.empty}>사용자를 선택해 주세요.</Text>}
          {selected && (
            <View style={styles.detailBody}>
              <View>
                <Text style={styles.detailName}>@{selected.username}</Text>
                <Text style={[adminStyles.muted, { marginTop: 5 }]}>{selected.onboarding_completed ? '온보딩 완료' : '온보딩 미완료'} · {new Date(selected.created_at).toLocaleDateString('ko-KR')} 가입</Text>
              </View>

              <View style={styles.metaBox}>
                <Meta label="사용자 ID" value={selected.id} />
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
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function StatusBadge({ suspended }: { suspended: boolean }) {
  return <Text style={[styles.statusBadge, suspended && styles.statusBadgeSuspended]}>{suspended ? '정지' : '정상'}</Text>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text selectable style={styles.metaValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  summaryRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  summaryCard: { minWidth: 108, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  summaryLabel: { color: '#6B7280', fontSize: 11, fontWeight: '600' },
  summaryValue: { marginTop: 4, color: '#111827', fontSize: 20, fontWeight: '800' },
  toolbar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 520 },
  filterButton: { minHeight: 34, justifyContent: 'center', borderRadius: 17, paddingHorizontal: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  filterButtonActive: { backgroundColor: '#111827', borderColor: '#111827' },
  filterText: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#FFFFFF' },
  workspace: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  listPanel: { flexGrow: 1, flexBasis: 520, minWidth: 320 },
  detailPanel: { flexGrow: 1, flexBasis: 380, minWidth: 300 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  userRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: '#F0F1F3', borderRadius: 8 },
  userRowSelected: { backgroundColor: '#F7F7F8' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#4B5563', fontSize: 14, fontWeight: '800' },
  userBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
  username: { color: '#111827', fontSize: 14, fontWeight: '700' },
  adminBadge: { color: '#4B5563', backgroundColor: '#F3F4F6', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 3, fontSize: 10, fontWeight: '700' },
  statusBadge: { color: '#2F6B45', backgroundColor: '#ECFDF3', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '700' },
  statusBadgeSuspended: { color: '#9F2D2D', backgroundColor: '#FEF2F2' },
  detailBody: { marginTop: 18, gap: 18 },
  detailName: { color: '#111827', fontSize: 21, fontWeight: '800' },
  metaBox: { borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  metaRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F1F3' },
  metaLabel: { width: 82, color: '#6B7280', fontSize: 12, fontWeight: '700' },
  metaValue: { flex: 1, color: '#374151', fontSize: 12 },
  moderationBox: { gap: 10 },
  reasonInput: { minHeight: 88, textAlignVertical: 'top' },
  reasonText: { color: '#374151', fontSize: 13, lineHeight: 20, backgroundColor: '#F9FAFB', borderRadius: 8, padding: 12 },
  note: { color: '#6B7280', fontSize: 12, lineHeight: 19, backgroundColor: '#F9FAFB', borderRadius: 8, padding: 12 },
  disabled: { opacity: 0.5 },
});
