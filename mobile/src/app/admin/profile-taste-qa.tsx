import { StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { ProfileAiPanel } from '@/components/profile-ai-panel';
import { ProfileTasteComposition } from '@/components/profile-taste-composition';
import type { ProfileAiStatus } from '@/services/profileAiService';
import type { ProfileTasteComposition as ProfileTasteCompositionValue } from '@/services/profileTasteCompositionService';

const FIVE_STATUS: ProfileAiStatus = {
  currentPickCount: 5,
  minimumPicks: 5,
  recommendedPicks: 10,
  hasReview: false,
  reviewPickCount: 0,
  changedCount: 0,
  minimumChanges: 5,
  retryAfterSeconds: 0,
  canGenerate: true,
  reason: 'READY_FIRST',
  generatedAt: null,
  isVisible: false,
  isStale: false,
};

const TEN_STATUS: ProfileAiStatus = {
  currentPickCount: 10,
  minimumPicks: 5,
  recommendedPicks: 10,
  hasReview: true,
  reviewPickCount: 5,
  changedCount: 5,
  minimumChanges: 5,
  retryAfterSeconds: 0,
  canGenerate: true,
  reason: 'READY_TEN_PICK_UPGRADE',
  generatedAt: '2026-09-19T00:00:00.000Z',
  isVisible: false,
  isStale: true,
};

const FIVE_COMPOSITION: ProfileTasteCompositionValue = {
  profileId: 'qa-five',
  totalPickCount: 5,
  mappedPickCount: 5,
  unmappedPickCount: 0,
  dimensions: [
    {
      code: 'culture', name: '문화', pickCount: 2, categoryCount: 2, percentage: 40,
      categories: [
        { categoryId: 'drama', categoryName: '드라마', categorySlug: 'drama', pickCount: 1 },
        { categoryId: 'youtube', categoryName: '유튜브', categorySlug: 'youtube', pickCount: 1 },
      ],
    },
    {
      code: 'food', name: '음식', pickCount: 1, categoryCount: 1, percentage: 20,
      categories: [{ categoryId: 'snacks', categoryName: '과자', categorySlug: 'snacks', pickCount: 1 }],
    },
    {
      code: 'tech', name: '기술', pickCount: 1, categoryCount: 1, percentage: 20,
      categories: [{ categoryId: 'smartphone', categoryName: '스마트폰', categorySlug: 'smartphone', pickCount: 1 }],
    },
    {
      code: 'living', name: '생활', pickCount: 1, categoryCount: 1, percentage: 20,
      categories: [{ categoryId: 'notebook', categoryName: '노트', categorySlug: 'notebook', pickCount: 1 }],
    },
  ],
};

const TEN_COMPOSITION: ProfileTasteCompositionValue = {
  profileId: 'qa-ten',
  totalPickCount: 10,
  mappedPickCount: 10,
  unmappedPickCount: 0,
  dimensions: [
    {
      code: 'culture', name: '문화', pickCount: 3, categoryCount: 3, percentage: 30,
      categories: [
        { categoryId: 'game', categoryName: '게임', categorySlug: 'game', pickCount: 1 },
        { categoryId: 'drama', categoryName: '드라마', categorySlug: 'drama', pickCount: 1 },
        { categoryId: 'youtube', categoryName: '유튜브', categorySlug: 'youtube', pickCount: 1 },
      ],
    },
    {
      code: 'food', name: '음식', pickCount: 2, categoryCount: 2, percentage: 20,
      categories: [
        { categoryId: 'snacks', categoryName: '과자', categorySlug: 'snacks', pickCount: 1 },
        { categoryId: 'ramen', categoryName: '라면', categorySlug: 'ramen', pickCount: 1 },
      ],
    },
    {
      code: 'tech', name: '기술', pickCount: 2, categoryCount: 2, percentage: 20,
      categories: [
        { categoryId: 'smartphone', categoryName: '스마트폰', categorySlug: 'smartphone', pickCount: 1 },
        { categoryId: 'headphones', categoryName: '헤드폰·이어폰', categorySlug: 'headphones-earphones', pickCount: 1 },
      ],
    },
    {
      code: 'living', name: '생활', pickCount: 2, categoryCount: 2, percentage: 20,
      categories: [
        { categoryId: 'notebook', categoryName: '노트', categorySlug: 'notebook', pickCount: 1 },
        { categoryId: 'pen', categoryName: '볼펜', categorySlug: 'ballpoint-pen', pickCount: 1 },
      ],
    },
    {
      code: 'style', name: '스타일', pickCount: 1, categoryCount: 1, percentage: 10,
      categories: [{ categoryId: 'perfume', categoryName: '향수', categorySlug: 'perfume', pickCount: 1 }],
    },
  ],
};

export default function AdminProfileTasteQaScreen() {
  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>프로필 취향 QA</Text>
        <Text style={adminStyles.pageDescription}>
          실제 사용자 데이터와 네트워크 호출 없이 5개 최초 평가와 10개 업그레이드 상태를 동일 컴포넌트로 비교합니다.
        </Text>
      </View>

      <View style={[adminStyles.card, styles.notice]}>
        <Text style={styles.noticeTitle}>QA 전용 · 읽기 전용</Text>
        <Text style={adminStyles.muted}>
          아래 버튼은 시각 확인용이며 AI 생성 요청이나 DB 변경을 실행하지 않습니다.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>모바일 폭 · 390px</Text>
      <View style={styles.previewGrid}>
        <PreviewFrame title="5개 · 최초 AI 평가" width={390}>
          <ProfileTasteComposition profileId="qa-five" previewValue={FIVE_COMPOSITION} />
          <ProfileAiPanel profileId="qa-five" currentPickCount={5} previewStatus={FIVE_STATUS} />
        </PreviewFrame>
        <PreviewFrame title="10개 · 즉시 업그레이드" width={390}>
          <ProfileTasteComposition profileId="qa-ten" previewValue={TEN_COMPOSITION} />
          <ProfileAiPanel profileId="qa-ten" currentPickCount={10} previewStatus={TEN_STATUS} />
        </PreviewFrame>
      </View>

      <Text style={styles.sectionTitle}>데스크톱 폭 · 640px</Text>
      <View style={styles.previewGrid}>
        <PreviewFrame title="5개 · 최초 AI 평가" width={640}>
          <ProfileTasteComposition profileId="qa-five-desktop" previewValue={FIVE_COMPOSITION} />
          <ProfileAiPanel profileId="qa-five-desktop" currentPickCount={5} previewStatus={FIVE_STATUS} />
        </PreviewFrame>
        <PreviewFrame title="10개 · 즉시 업그레이드" width={640}>
          <ProfileTasteComposition profileId="qa-ten-desktop" previewValue={TEN_COMPOSITION} />
          <ProfileAiPanel profileId="qa-ten-desktop" currentPickCount={10} previewStatus={TEN_STATUS} />
        </PreviewFrame>
      </View>
    </View>
  );
}

function PreviewFrame({ title, width, children }: { title: string; width: number; children: React.ReactNode }) {
  return (
    <View style={styles.frameOuter}>
      <View style={styles.frameHeader}>
        <Text style={styles.frameTitle}>{title}</Text>
        <Text style={styles.frameWidth}>{width}px</Text>
      </View>
      <View style={[styles.frame, { width, maxWidth: '100%' }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 18 },
  notice: { gap: 6 },
  noticeTitle: { color: '#111827', fontSize: 13, fontWeight: '800' },
  sectionTitle: { color: '#374151', fontSize: 14, fontWeight: '800', marginTop: 8 },
  previewGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' },
  frameOuter: { gap: 8, flexShrink: 1 },
  frameHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  frameTitle: { color: '#374151', fontSize: 12, fontWeight: '800' },
  frameWidth: { color: '#9CA3AF', fontSize: 10, fontWeight: '700' },
  frame: {
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#D9DCE3',
    borderRadius: 18,
    padding: 18,
    overflow: 'hidden',
  },
});
