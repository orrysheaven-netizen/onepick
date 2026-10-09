// Tabs of the admin /admin/data page and the sidebar sections that group them.
// Kept outside the route file so the dashboard (and anything else that
// deep-links into a tab) can import the type without importing a screen.
export type AdminDataTab = 'categories' | 'brands' | 'providers' | 'items' | 'channels' | 'editorial' | 'pending' | 'photos' | 'links' | 'users' | 'reports' | 'audit' | 'feedback';

export const ADMIN_DATA_TABS: Array<{ key: AdminDataTab; label: string; description: string }> = [
  { key: 'feedback', label: '의견 수신 이메일', description: '사용자 의견을 받을 공개 이메일 주소를 설정해요.' },
  { key: 'categories', label: '카테고리', description: '최대 3단계까지 카테고리를 구성하고, 노출 여부·Pick 가능 여부·상태와 정렬 순서를 관리합니다.' },
  { key: 'brands', label: '브랜드', description: '상품 등록에 사용할 브랜드를 추가하고 활성 상태를 관리합니다.' },
  { key: 'providers', label: '판매처', description: '온라인 공식 판매처를 생성·검색하고 브랜드 연결과 노출 상태를 관리합니다.' },
  { key: 'items', label: '상품', description: '상품 상태, 운영 메타데이터와 검색 별칭을 관리합니다.' },
  { key: 'channels', label: '맛집 채널 연결', description: '매장·온라인 정보 없이 등록된 기존 음식 원픽 항목을 장소나 온라인 판매처에 연결합니다. 연결하면 홈의 매장/온라인 탭에 나오고, 기존 원픽은 그대로 유지됩니다.' },
  { key: 'editorial', label: '홈 추천', description: '초기 운영에서 먼저 소개할 원픽을 직접 고릅니다. 사용자 추천 수·인기 순위와는 별도입니다.' },
  { key: 'pending', label: '검수 대기', description: '사용자가 추가한 pending 상품을 승인, 반려하거나 기존 상품과 병합합니다.' },
  { key: 'photos', label: '사진 검수', description: '공개 상품에 처음 올라온 사용자 사진을 승인하거나 반려합니다. 승인 전에는 올린 사람에게만 보이고, 승인하면 대표사진이 되며 이 사진을 기다리던 원픽도 공개됩니다. 반려하면 사진만 빠지고 원픽은 유지됩니다.' },
  { key: 'links', label: '지도 링크 제안', description: '사용자가 원픽을 등록하며 남긴 네이버 지도 링크를 확인합니다. 승인하면 그 매장의 모든 메뉴 원픽에서 지도 링크가 열립니다.' },
  { key: 'users', label: '사용자', description: '사용자를 조회하고 계정을 정지하거나 해제합니다. 정지된 사용자의 공개 콘텐츠는 숨겨지고 새 Pick·댓글 작성이 차단됩니다.' },
  { key: 'reports', label: '신고', description: '프로필·Pick·댓글 신고를 확인하고 처리 상태 및 신고 대상 계정 제재를 관리합니다.' },
  { key: 'audit', label: '운영 기록', description: '카테고리·브랜드·상품·신고·사용자 제재에 대한 관리자 변경 기록과 앱 오류 발생 현황을 확인합니다.' },
];

export const DEFAULT_ADMIN_DATA_TAB: AdminDataTab = 'categories';

export function isAdminDataTab(value: unknown): value is AdminDataTab {
  return typeof value === 'string' && ADMIN_DATA_TABS.some((tab) => tab.key === value);
}

export type AdminNavItem = { href: string; label: string; tab?: AdminDataTab };
export type AdminNavSection = { title: string | null; items: AdminNavItem[] };

function tabItem(tab: AdminDataTab): AdminNavItem {
  const entry = ADMIN_DATA_TABS.find((candidate) => candidate.key === tab)!;
  return { href: `/admin/data?tab=${tab}`, label: entry.label, tab };
}

// Work queues first, then the catalogue, then people and history; QA tools last.
export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  { title: null, items: [{ href: '/admin/dashboard', label: '원픽 대시보드' }] },
  { title: '처리 대기', items: [tabItem('pending'), tabItem('photos'), tabItem('links'), tabItem('reports')] },
  { title: '콘텐츠', items: [tabItem('categories'), tabItem('brands'), tabItem('providers'), tabItem('items'), tabItem('channels'), tabItem('editorial')] },
  { title: '사용자·기록', items: [tabItem('users'), tabItem('audit')] },
  { title: '앱 설정', items: [tabItem('feedback')] },
  {
    title: 'QA 도구',
    items: [
      { href: '/admin/place-catalog-qa', label: '맛집 데이터 QA' },
      { href: '/admin/profile-taste-qa', label: '취향 QA' },
    ],
  },
];

export function adminNavSectionTitle(tab: AdminDataTab) {
  return ADMIN_NAV_SECTIONS.find((section) => section.items.some((item) => item.tab === tab))?.title ?? null;
}

