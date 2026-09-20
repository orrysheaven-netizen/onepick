// Tabs of the admin "데이터 관리" page. Kept outside the route file so the
// dashboard (and anything else that deep-links into a tab) can import the
// type without importing a screen.
export type AdminDataTab = 'categories' | 'brands' | 'items' | 'editorial' | 'pending' | 'users' | 'reports' | 'audit';

export const ADMIN_DATA_TABS: Array<{ key: AdminDataTab; label: string; description: string }> = [
  { key: 'categories', label: '카테고리', description: '최대 3단계까지 카테고리를 구성하고, 노출 여부·Pick 가능 여부·상태와 정렬 순서를 관리합니다.' },
  { key: 'brands', label: '브랜드', description: '상품 등록에 사용할 브랜드를 추가하고 활성 상태를 관리합니다.' },
  { key: 'items', label: '상품', description: '상품 상태, 운영 메타데이터와 검색 별칭을 관리합니다.' },
  { key: 'editorial', label: '홈 추천', description: '초기 운영에서 먼저 소개할 원픽을 직접 고릅니다. 사용자 추천 수·인기 순위와는 별도입니다.' },
  { key: 'pending', label: '검수 대기', description: '사용자가 추가한 pending 상품을 승인, 반려하거나 기존 상품과 병합합니다.' },
  { key: 'users', label: '사용자', description: '사용자를 조회하고 계정을 정지하거나 해제합니다. 정지된 사용자의 공개 콘텐츠는 숨겨지고 새 Pick·댓글 작성이 차단됩니다.' },
  { key: 'reports', label: '신고', description: '프로필·Pick·댓글 신고를 확인하고 처리 상태 및 신고 대상 계정 제재를 관리합니다.' },
  { key: 'audit', label: '운영 기록', description: '카테고리·브랜드·상품·신고·사용자 제재에 대한 관리자 변경 기록과 앱 오류 발생 현황을 확인합니다.' },
];

export const DEFAULT_ADMIN_DATA_TAB: AdminDataTab = 'categories';

export function isAdminDataTab(value: unknown): value is AdminDataTab {
  return typeof value === 'string' && ADMIN_DATA_TABS.some((tab) => tab.key === value);
}
