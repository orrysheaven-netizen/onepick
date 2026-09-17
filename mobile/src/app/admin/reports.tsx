import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAdminAccess } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useAdminReportActions, useAdminReports } from '@/hooks/useSafety';
import type { ContentReport, ReportReason, ReportStatus, ReportTargetType } from '@/types/domain/safety';

const statusLabel: Record<ReportStatus, string> = {
  open: '접수',
  reviewing: '검토 중',
  resolved: '처리 완료',
  dismissed: '기각',
};
const reasonLabel: Record<ReportReason, string> = {
  spam: '스팸',
  harassment: '괴롭힘',
  inappropriate: '부적절한 콘텐츠',
  misleading: '잘못된 정보',
  other: '기타',
};
const targetLabel: Record<ReportTargetType, string> = {
  profile: '프로필',
  pick: '원픽',
  comment: '댓글',
};

function ReportCard({ report, busy, onStatus }: {
  report: ContentReport;
  busy: boolean;
  onStatus: (status: ReportStatus) => void;
}) {
  const router = useRouter();
  const openTarget = () => {
    if (report.targetType === 'pick') {
      router.push({ pathname: '/pick/[pickId]', params: { pickId: report.targetId } });
      return;
    }
    if (report.targetType === 'profile' && report.targetUsername) {
      router.push({ pathname: '/u/[username]', params: { username: report.targetUsername } });
    }
  };
  const canOpen = report.targetType === 'pick' || (report.targetType === 'profile' && Boolean(report.targetUsername));

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.badge}><Text style={styles.badgeText}>{statusLabel[report.status]}</Text></View>
        <Text style={styles.date}>{report.createdAt.slice(0, 10)}</Text>
      </View>
      <Text style={styles.cardTitle}>{targetLabel[report.targetType]} · {reasonLabel[report.reason]}</Text>
      <Text style={styles.meta}>신고자: @{report.reporterUsername ?? '탈퇴 사용자'}</Text>
      <Text style={styles.meta}>대상: @{report.targetUsername ?? '탈퇴 사용자'}</Text>
      {report.details ? <Text style={styles.details}>{report.details}</Text> : null}
      <Text numberOfLines={1} style={styles.idText}>대상 ID: {report.targetId}</Text>

      <View style={styles.actions}>
        {canOpen ? <Action label="대상 열기" disabled={busy} onPress={openTarget} /> : null}
        {report.status === 'open' ? <Action label="검토 시작" disabled={busy} onPress={() => onStatus('reviewing')} /> : null}
        {report.status === 'open' || report.status === 'reviewing' ? (
          <>
            <Action label="처리 완료" primary disabled={busy} onPress={() => onStatus('resolved')} />
            <Action label="기각" disabled={busy} onPress={() => onStatus('dismissed')} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function Action({ label, onPress, disabled = false, primary = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, primary && styles.actionPrimary, (pressed || disabled) && styles.muted]}>
      <Text style={[styles.actionText, primary && styles.actionPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

export default function AdminReportsScreen() {
  const router = useRouter();
  const auth = useAuthSession();
  const admin = useAdminAccess(auth.user?.id);
  const reports = useAdminReports(admin.data === true);
  const update = useAdminReportActions();
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const visible = useMemo(() => {
    const rows = reports.data ?? [];
    if (filter === 'all') return rows;
    return rows.filter((report) => report.status === 'open' || report.status === 'reviewing');
  }, [reports.data, filter]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.muted]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.eyebrow}>ONEPICK ADMIN</Text>
        <Text style={styles.title}>신고 관리</Text>

        {auth.isLoading || admin.isPending ? <ActivityIndicator style={styles.loading} /> : null}
        {!auth.isLoading && !auth.user ? <Text style={styles.notice}>로그인이 필요합니다.</Text> : null}
        {admin.data === false ? <Text style={styles.notice}>관리자 권한이 필요합니다.</Text> : null}

        {admin.data === true ? (
          <>
            <View style={styles.filterRow}>
              <Action label="처리할 신고" primary={filter === 'active'} onPress={() => setFilter('active')} />
              <Action label="전체 이력" primary={filter === 'all'} onPress={() => setFilter('all')} />
              <Action label="새로고침" disabled={reports.isFetching} onPress={() => void reports.refetch()} />
            </View>

            {reports.isPending ? <ActivityIndicator style={styles.loading} /> : null}
            {reports.isError ? <Text style={styles.error}>신고 목록을 불러오지 못했습니다.</Text> : null}
            {update.isError ? <Text style={styles.error}>신고 상태를 저장하지 못했습니다.</Text> : null}
            {!reports.isPending && visible.length === 0 ? <Text style={styles.notice}>표시할 신고가 없습니다.</Text> : null}

            {visible.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                busy={update.isPending}
                onStatus={(status) => void update.mutateAsync({ reportId: report.id, status })}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FAF8F5' },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 60 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  eyebrow: { color: '#A9482D', fontSize: 10, fontWeight: '800', letterSpacing: 2.2, marginTop: 8 },
  title: { color: '#202124', fontSize: 28, fontWeight: '900', marginTop: 7, marginBottom: 20 },
  loading: { marginVertical: 24 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: '#F7E7DD', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: '#A9482D', fontSize: 9, fontWeight: '900' },
  date: { color: '#A29B95', fontSize: 10 },
  cardTitle: { color: '#202124', fontSize: 16, fontWeight: '900', marginTop: 12 },
  meta: { color: '#6C6863', fontSize: 11, marginTop: 6 },
  details: { color: '#4F4B47', fontSize: 12, lineHeight: 18, backgroundColor: '#FAF8F5', borderRadius: 12, padding: 12, marginTop: 10 },
  idText: { color: '#AAA39C', fontSize: 9, marginTop: 9 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  actionButton: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: '#DDD5CD', borderRadius: 12, paddingHorizontal: 12 },
  actionPrimary: { backgroundColor: '#252B38', borderColor: '#252B38' },
  actionText: { color: '#625A53', fontSize: 10, fontWeight: '800' },
  actionPrimaryText: { color: '#FFFFFF' },
  notice: { color: '#6C6863', fontSize: 12, lineHeight: 19, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginTop: 10 },
  error: { color: '#A9482D', fontSize: 11, lineHeight: 17, marginBottom: 12 },
  muted: { opacity: 0.55 },
});
