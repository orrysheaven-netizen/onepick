import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getOnePickDashboard } from '@/lib/admin-api';
import type { AdminOnePickDashboard, AdminOnePickDashboardWindow } from '@/lib/admin-api';
import type { AdminDataTab } from '@/lib/admin/dataTabs';

const WINDOWS: Array<{ value: AdminOnePickDashboardWindow; label: string }> = [
  { value: 7, label: '7일' },
  { value: 30, label: '30일' },
  { value: 90, label: '90일' },
];

type TrendSeries = 'picks' | 'users' | 'comments';

const TREND_SERIES: Array<{ value: TrendSeries; label: string }> = [
  { value: 'picks', label: '원픽 등록' },
  { value: 'users', label: '신규 가입' },
  { value: 'comments', label: '댓글' },
];

const FUNNEL_STEPS: Array<{ key: keyof AdminOnePickDashboard['funnel']; label: string }> = [
  { key: 'auth_started', label: '로그인 시작' },
  { key: 'auth_completed', label: '로그인 완료' },
  { key: 'item_detail_viewed', label: '상품 상세 조회' },
  { key: 'pick_created', label: '원픽 등록' },
  { key: 'pick_share_clicked', label: '공유 클릭' },
  { key: 'pick_link_opened', label: '공유 링크 방문' },
];

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [days, setDays] = useState<AdminOnePickDashboardWindow>(30);
  const [series, setSeries] = useState<TrendSeries>('picks');
  const [data, setData] = useState<AdminOnePickDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (window: AdminOnePickDashboardWindow) => {
    setLoading(true);
    setError('');
    try {
      setData(await getOnePickDashboard(window));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '대시보드 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const goToData = (tab: AdminDataTab) => router.push({ pathname: '/admin/data', params: { tab } });

  const trendTotal = useMemo(
    () => (data ? data.daily.reduce((sum, bucket) => sum + bucket[series], 0) : 0),
    [data, series],
  );
  const categoryMax = useMemo(
    () => (data ? Math.max(1, ...data.categories.map((category) => category.active_picks)) : 1),
    [data],
  );

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={adminStyles.pageTitle}>원픽 대시보드</Text>
          <Text style={adminStyles.pageDescription}>실제 사용자의 원픽 활동만 집계합니다. 데모 계정과 관리자 계정의 활동은 모든 지표에서 제외됩니다.</Text>
        </View>
        <View style={styles.headerControls}>
          <View style={styles.segmented}>
            {WINDOWS.map((window) => (
              <Pressable
                key={window.value}
                accessibilityRole="button"
                accessibilityState={{ selected: days === window.value }}
                onPress={() => setDays(window.value)}
                style={[styles.segment, days === window.value && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, days === window.value && styles.segmentTextActive]}>{window.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable disabled={loading} onPress={() => void load(days)} style={adminStyles.secondaryButton}>
            <Text style={adminStyles.secondaryButtonText}>{loading ? '새로고침 중' : '새로고침'}</Text>
          </Pressable>
        </View>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}

      {loading && !data ? (
        <View style={[adminStyles.card, styles.loadingCard]}>
          <ActivityIndicator />
          <Text style={adminStyles.muted}>원픽 지표를 집계하고 있습니다.</Text>
        </View>
      ) : data ? (
        <>
          <Text style={styles.exclusionNote}>
            데모 계정 {data.excluded.demo_users}개 · 관리자 계정 {data.excluded.admin_users}개 제외 · 한국 시간 기준 · {formatGeneratedAt(data.generated_at)} 집계
          </Text>

          <Section title="처리 필요" hint="운영 큐 · 제외 없이 전체 집계">
            <View style={styles.metricGrid}>
              <MetricCard label="검수 대기 상품" value={data.queue.pending_items} detail="등록 요청 확인" attention={data.queue.pending_items > 0} onPress={() => goToData('pending')} />
              <MetricCard label="미처리 신고" value={data.queue.open_reports} detail="미처리 + 검토 중" attention={data.queue.open_reports > 0} onPress={() => goToData('reports')} />
              <MetricCard label="정지 사용자" value={data.queue.suspended_users} detail="현재 제재 계정" attention={data.queue.suspended_users > 0} onPress={() => goToData('users')} />
            </View>
          </Section>

          <Section title="원픽 핵심 지표" hint="데모 · 관리자 제외">
            <View style={styles.metricGrid}>
              <MetricCard
                label="사용자"
                value={data.totals.users}
                detail={`신규 7일 +${fmt(data.recent.users_7d)} · 30일 +${fmt(data.recent.users_30d)}`}
                onPress={() => goToData('users')}
              />
              <MetricCard
                label="활성 원픽"
                value={data.totals.active_picks}
                detail={`등록 7일 +${fmt(data.recent.picks_7d)} · 30일 +${fmt(data.recent.picks_30d)} · 누적 ${fmt(data.totals.picks_total)}`}
              />
              <MetricCard
                label="댓글"
                value={data.totals.comments}
                detail={`7일 +${fmt(data.recent.comments_7d)} · 30일 +${fmt(data.recent.comments_30d)}`}
              />
              <MetricCard
                label="활동 사용자 (7일)"
                value={data.recent.active_users_7d}
                detail={`30일 ${fmt(data.recent.active_users_30d)}명 · 원픽 등록 또는 댓글 작성`}
              />
            </View>
          </Section>

          <View style={adminStyles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={adminStyles.sectionTitle}>최근 {data.days}일 추이</Text>
                <Text style={[adminStyles.muted, styles.cardHint]}>
                  {TREND_SERIES.find((entry) => entry.value === series)?.label} 합계 {fmt(trendTotal)} · 일별
                </Text>
              </View>
              <View style={styles.chipRow}>
                {TREND_SERIES.map((entry) => (
                  <Pressable
                    key={entry.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: series === entry.value }}
                    onPress={() => setSeries(entry.value)}
                    style={[styles.chip, series === entry.value && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, series === entry.value && styles.chipTextActive]}>{entry.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <TrendChart daily={data.daily} series={series} />
          </View>

          <View style={styles.columns}>
            <View style={[adminStyles.card, styles.column]}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={adminStyles.sectionTitle}>카테고리별 활성 원픽</Text>
                  <Text style={[adminStyles.muted, styles.cardHint]}>운영 중 카테고리 {data.totals.open_categories}개 · 활성 상품 {fmt(data.totals.active_items)}개</Text>
                </View>
                <Pressable onPress={() => goToData('categories')}><Text style={styles.textLink}>카테고리 관리</Text></Pressable>
              </View>
              {data.categories.length === 0 ? (
                <Text style={styles.empty}>운영 중인 카테고리가 없습니다.</Text>
              ) : data.categories.map((category) => (
                <View key={category.id} style={styles.categoryRow}>
                  <View style={styles.categoryLabel}>
                    <Text numberOfLines={1} style={styles.categoryName}>{category.name}</Text>
                    <Text style={styles.categoryMeta}>{fmt(category.pickers)}명 · 최근 {data.days}일 +{fmt(category.picks_in_window)}</Text>
                  </View>
                  <View style={styles.categoryBarTrack}>
                    <View style={[styles.categoryBar, { width: `${Math.round((category.active_picks / categoryMax) * 100)}%` }]} />
                  </View>
                  <Text style={styles.categoryValue}>{fmt(category.active_picks)}</Text>
                </View>
              ))}
            </View>

            <View style={[adminStyles.card, styles.column]}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={adminStyles.sectionTitle}>인기 원픽 상품 TOP 10</Text>
                  <Text style={[adminStyles.muted, styles.cardHint]}>현재 활성 원픽 기준</Text>
                </View>
                <Pressable onPress={() => goToData('items')}><Text style={styles.textLink}>상품 관리</Text></Pressable>
              </View>
              {data.top_items.length === 0 ? (
                <Text style={styles.empty}>아직 실제 사용자의 원픽이 없습니다.</Text>
              ) : data.top_items.map((item, index) => (
                <View key={item.id} style={styles.topItemRow}>
                  <Text style={styles.rank}>{index + 1}</Text>
                  <View style={styles.topItemBody}>
                    <Text numberOfLines={1} style={styles.topItemName}>{item.name}</Text>
                    <Text style={adminStyles.muted}>{item.category_name}</Text>
                  </View>
                  <Text style={styles.topItemValue}>{fmt(item.active_picks)}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={adminStyles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={adminStyles.sectionTitle}>최근 {data.days}일 퍼널</Text>
                <Text style={[adminStyles.muted, styles.cardHint]}>이벤트 수 · 데모·관리자 행위와 그 계정의 원픽에 붙은 이벤트 제외</Text>
              </View>
            </View>
            <View style={styles.funnelGrid}>
              {FUNNEL_STEPS.map((step) => (
                <View key={step.key} style={styles.funnelCard}>
                  <Text style={styles.funnelValue}>{fmt(data.funnel[step.key])}</Text>
                  <Text style={styles.funnelLabel}>{step.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.eyebrow}>{title}</Text>
        {!!hint && <Text style={styles.eyebrowHint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

function MetricCard({ label, value, detail, attention = false, onPress }: { label: string; value: number; detail: string; attention?: boolean; onPress?: () => void }) {
  const content = (
    <>
      <Text style={[styles.metricValue, attention && styles.metricValueAttention]}>{fmt(value)}</Text>
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

// Plain-View bar chart: the admin panel is web-only and has no chart
// dependency, and daily counts at this scale read fine as bars.
function TrendChart({ daily, series }: { daily: AdminOnePickDashboard['daily']; series: TrendSeries }) {
  const max = Math.max(1, ...daily.map((bucket) => bucket[series]));
  const showValues = daily.length <= 14;
  const labelEvery = daily.length <= 14 ? 1 : daily.length <= 31 ? 5 : 15;

  return (
    <View style={styles.chart}>
      <View style={styles.chartBars}>
        {daily.map((bucket) => {
          const value = bucket[series];
          const height = value === 0 ? 2 : Math.max(4, Math.round((value / max) * 100));
          return (
            <View key={bucket.day} style={styles.chartColumn}>
              {showValues && <Text style={styles.chartValue}>{value > 0 ? value : ''}</Text>}
              <View style={styles.chartBarArea}>
                <View style={[styles.chartBar, value === 0 && styles.chartBarEmpty, { height: `${height}%` }]} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.chartAxis}>
        {daily.map((bucket, index) => {
          const isLast = index === daily.length - 1;
          const show = index % labelEvery === 0 || isLast;
          return (
            <View key={bucket.day} style={styles.chartColumn}>
              {show && <Text numberOfLines={1} style={styles.chartLabel}>{formatDay(bucket.day)}</Text>}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function fmt(value: number) {
  return value.toLocaleString('ko-KR');
}

function formatDay(value: string) {
  const [, month, day] = value.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(value));
}

const styles = StyleSheet.create({
  page: { gap: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  headerText: { flexShrink: 1, maxWidth: 640 },
  headerControls: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  segmented: { flexDirection: 'row', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 9, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  segment: { minHeight: 38, minWidth: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  segmentActive: { backgroundColor: '#111827' },
  segmentText: { color: '#374151', fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: '#FFFFFF' },
  loadingCard: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 10 },
  exclusionNote: { color: '#6B7280', fontSize: 12, lineHeight: 18 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  eyebrow: { color: '#111827', fontSize: 13, fontWeight: '800' },
  eyebrowHint: { color: '#9CA3AF', fontSize: 11, fontWeight: '600' },
  metricGrid: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  metricCard: { flexGrow: 1, flexBasis: 220, minWidth: 190, minHeight: 128, justifyContent: 'center' },
  metricCardInteractive: { cursor: 'pointer' as never },
  metricValue: { color: '#111827', fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  metricValueAttention: { color: '#9F2D2D' },
  metricLabel: { color: '#374151', fontSize: 14, fontWeight: '800', marginTop: 8 },
  metricDetail: { color: '#9CA3AF', fontSize: 11, marginTop: 5, lineHeight: 16 },
  pressed: { opacity: 0.72 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 14 },
  cardHint: { marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  chipActive: { backgroundColor: '#111827', borderColor: '#111827' },
  chipText: { color: '#6B7280', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  chart: { gap: 6 },
  chartBars: { height: 170, flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  chartColumn: { flex: 1, minWidth: 0, alignItems: 'stretch', height: '100%', justifyContent: 'flex-end' },
  chartValue: { color: '#6B7280', fontSize: 10, fontWeight: '700', textAlign: 'center', marginBottom: 3 },
  chartBarArea: { flex: 1, justifyContent: 'flex-end' },
  chartBar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: '#111827' },
  chartBarEmpty: { backgroundColor: '#E5E7EB' },
  chartAxis: { flexDirection: 'row', gap: 2, minHeight: 14 },
  chartLabel: { color: '#9CA3AF', fontSize: 10 },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  column: { flexGrow: 1, flexBasis: 430, minWidth: 300 },
  textLink: { color: '#374151', fontSize: 12, fontWeight: '700' },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  categoryLabel: { width: 150 },
  categoryName: { color: '#111827', fontSize: 13, fontWeight: '700' },
  categoryMeta: { marginTop: 2, color: '#9CA3AF', fontSize: 10 },
  categoryBarTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#F3F4F6', overflow: 'hidden' },
  categoryBar: { height: '100%', borderRadius: 5, backgroundColor: '#111827' },
  categoryValue: { width: 44, textAlign: 'right', color: '#111827', fontSize: 13, fontWeight: '800' },
  topItemRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  rank: { width: 24, color: '#9CA3AF', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  topItemBody: { flex: 1, minWidth: 0 },
  topItemName: { color: '#111827', fontSize: 13, fontWeight: '700', marginBottom: 3 },
  topItemValue: { color: '#111827', fontSize: 14, fontWeight: '800' },
  funnelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  funnelCard: { flexGrow: 1, flexBasis: 150, minWidth: 130, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB', borderRadius: 10, padding: 14 },
  funnelValue: { color: '#111827', fontSize: 22, fontWeight: '900' },
  funnelLabel: { color: '#6B7280', fontSize: 11, marginTop: 4 },
});
