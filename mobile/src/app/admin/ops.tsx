import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { useAdminOperations } from '@/hooks/useAdmin';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { AdminAuditLog } from '@/types/domain/operations';

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', { hour12: false });
}

function auditTitle(item: AdminAuditLog) {
  const entity = item.entityType === 'category' ? '카테고리'
    : item.entityType === 'brand' ? '브랜드'
      : item.entityType === 'item' ? '제품' : '신고';
  const action = item.action === 'insert' ? '생성' : item.action === 'update' ? '수정' : '삭제';
  return `${entity} ${action}`;
}

function auditDetail(item: AdminAuditLog) {
  const name = typeof item.summary.name === 'string' ? item.summary.name : null;
  const status = typeof item.summary.status === 'string' ? item.summary.status : null;
  return [name, status].filter(Boolean).join(' · ') || item.entityId.slice(0, 8);
}

export default function AdminOperationsScreen() {
  const auth = useAuthSession();
  const query = useAdminOperations(auth.user?.id);
  const forbidden = query.error instanceof AppError && query.error.code === 'FORBIDDEN';

  return (
    <View style={styles.content}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.kicker}>ONEPICK OPERATIONS</Text>
            <Text style={styles.title}>운영 지표</Text>
            <Text style={styles.description}>서비스 원본 데이터에서 집계한 핵심 지표, 퍼널과 관리자 변경 이력을 확인합니다.</Text>
          </View>
          <Pressable disabled={query.isFetching} onPress={() => void query.refetch()} style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}>
            {query.isFetching ? <ActivityIndicator size="small" /> : <Text style={styles.refreshButtonText}>새로고침</Text>}
          </Pressable>
        </View>

        {auth.isLoading || query.isPending ? (
          <View style={styles.state}><ActivityIndicator /><Text style={styles.stateText}>운영 상태를 확인하고 있어요</Text></View>
        ) : !auth.user ? (
          <View style={styles.state}><Text style={styles.stateTitle}>로그인이 필요합니다</Text></View>
        ) : forbidden ? (
          <View style={styles.state}><Text style={styles.stateTitle}>관리자 권한이 필요합니다</Text></View>
        ) : query.isError || !query.data ? (
          <View style={styles.state}>
            <Text style={styles.stateTitle}>운영 현황을 불러오지 못했어요</Text>
            <Pressable onPress={() => void query.refetch()} style={styles.darkButton}><Text style={styles.darkButtonText}>다시 불러오기</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={styles.metricGrid}>
              {[
                ['사용자', query.data.metrics.profiles],
                ['활성 원픽', query.data.metrics.activePicks],
                ['댓글', query.data.metrics.comments],
                ['정식 제품', query.data.metrics.activeItems],
                ['승인 대기', query.data.metrics.pendingItems],
                ['미처리 신고', query.data.metrics.openReports],
              ].map(([label, value]) => (
                <View key={String(label)} style={styles.metricCard}>
                  <Text style={styles.metricValue}>{value}</Text>
                  <Text style={styles.metricLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>최근 {query.data.funnel.days}일 퍼널</Text>
              <Text style={styles.sectionHint}>시드 계정 제외 · 이벤트 수</Text>
            </View>
            <View style={styles.funnelGrid}>
              {[
                ['원픽 등록', query.data.funnel.pickCreated],
                ['공유 클릭', query.data.funnel.pickShareClicked],
                ['공유 링크 방문', query.data.funnel.pickLinkOpened],
                ['제품 상세', query.data.funnel.itemDetailViewed],
                ['로그인 시작', query.data.funnel.authStarted],
                ['로그인 완료', query.data.funnel.authCompleted],
              ].map(([label, value]) => (
                <View key={String(label)} style={styles.funnelCard}>
                  <Text style={styles.funnelValue}>{value}</Text>
                  <Text style={styles.funnelLabel}>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.analyticsHint}>사용자·활성 원픽·댓글 지표도 시드 계정을 제외합니다.</Text>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>최근 오류 코드</Text>
              <Text style={styles.sectionHint}>{query.data.errorEvents.length}건</Text>
            </View>
            {query.data.errorSummary.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>기록된 앱 오류가 없습니다.</Text></View>
            ) : (
              query.data.errorSummary.slice(0, 12).map((item) => (
                <View key={item.code} style={styles.rowCard}>
                  <Text style={styles.rowTitle}>{item.code}</Text>
                  <Text style={styles.badge}>{item.count}건</Text>
                </View>
              ))
            )}

            {query.data.errorEvents.slice(0, 20).map((item) => (
              <View key={item.id} style={styles.logCard}>
                <Text style={styles.logTitle}>{item.errorCode}</Text>
                <Text style={styles.logDetail}>{item.context} · {item.platform ?? 'unknown'} · v{item.appVersion ?? '?'}</Text>
                <Text style={styles.logTime}>{formatTime(item.createdAt)}</Text>
              </View>
            ))}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>최근 관리자 변경</Text>
              <Text style={styles.sectionHint}>{query.data.auditLogs.length}건</Text>
            </View>
            {query.data.auditLogs.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>아직 관리자 변경 이력이 없습니다.</Text></View>
            ) : (
              query.data.auditLogs.map((item) => (
                <View key={item.id} style={styles.logCard}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.logTitle}>{auditTitle(item)}</Text>
                    <Text style={styles.badge}>{item.entityType}</Text>
                  </View>
                  <Text style={styles.logDetail}>{auditDetail(item)}</Text>
                  <Text style={styles.logTime}>{formatTime(item.createdAt)}</Text>
                </View>
              ))
            )}
          </>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  refreshButton: { minHeight: 40, borderRadius: 9, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  refreshButtonText: { color: '#374151', fontSize: 13, fontWeight: '700' },
  kicker: { color: '#4945ED', fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginTop: 16 },
  title: { color: '#202124', fontSize: 28, fontWeight: '900', marginTop: 7 },
  description: { color: '#747985', fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 24 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 },
  metricCard: { minWidth: 135, flexGrow: 1, borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16 },
  metricValue: { color: '#202124', fontSize: 25, fontWeight: '900' },
  metricLabel: { color: '#747985', fontSize: 12, marginTop: 5 },
  funnelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  funnelCard: { width: '31%', minWidth: 120, flexGrow: 1, borderWidth: 1, borderColor: '#DDDDF5', backgroundColor: '#F7F7FF', borderRadius: 15, padding: 14 },
  funnelValue: { color: '#4945ED', fontSize: 22, fontWeight: '900' },
  funnelLabel: { color: '#5F6470', fontSize: 11, marginTop: 4 },
  analyticsHint: { color: '#89909C', fontSize: 11, lineHeight: 17, marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16, marginBottom: 10 },
  sectionTitle: { color: '#202124', fontSize: 18, fontWeight: '900' },
  sectionHint: { color: '#89909C', fontSize: 12 },
  rowCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 8 },
  rowTitle: { flex: 1, color: '#202124', fontSize: 13, fontWeight: '800' },
  badge: { color: '#4945ED', fontSize: 11, fontWeight: '800', backgroundColor: '#EFEEFF', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  logCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 9 },
  logTitle: { color: '#202124', fontSize: 13, fontWeight: '900' },
  logDetail: { color: '#5F6470', fontSize: 12, lineHeight: 18, marginTop: 5 },
  logTime: { color: '#89909C', fontSize: 11, marginTop: 7 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  emptyCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18 },
  emptyText: { color: '#747985', fontSize: 12 },
  state: { alignItems: 'center', paddingVertical: 60 },
  stateTitle: { color: '#202124', fontSize: 18, fontWeight: '900' },
  stateText: { color: '#747985', fontSize: 12, marginTop: 9 },
  darkButton: { minHeight: 44, borderRadius: 14, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 18 },
  darkButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
