import type { AdminReport, AdminReportStatus } from '@/lib/admin-api';

export function reportTargetLabel(value: AdminReport['target_type']) {
  return ({ profile: '프로필', pick: 'Pick', comment: '댓글' } as const)[value];
}

export function reportReasonLabel(value: AdminReport['reason']) {
  return ({ spam: '스팸', harassment: '괴롭힘', inappropriate: '부적절한 콘텐츠', misleading: '오해 소지', other: '기타' } as const)[value];
}

export function reportStatusLabel(value: AdminReportStatus) {
  return ({ open: '미처리', reviewing: '검토 중', resolved: '처리 완료', dismissed: '기각' } as const)[value];
}
