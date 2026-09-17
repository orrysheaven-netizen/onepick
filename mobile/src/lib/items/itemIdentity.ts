// These categories have packaging normalization rules, not exclusive registration permission.
const PACKAGING_NORMALIZED_SLUGS = ['ramen', 'beer', 'soju', 'snacks'] as const;

export function canonicalItemName(value: string, slug: string) {
  let name = value.trim().replace(/\s+/g, ' ');
  if (!PACKAGING_NORMALIZED_SLUGS.includes(slug as typeof PACKAGING_NORMALIZED_SLUGS[number])) return name;
  name = name.replace(/\s*\d+(?:\.\d+)?\s*(?:kg|ml|g|l|개입|입|개|팩|봉|병|캔)(?=\s|$|[×xX])/gi, ' ').replace(/\s*[×xX]\s*\d+\s*$/g, '');
  if (slug === 'ramen') name = name.replace(/\s*(?:봉지면|컵라면|큰사발면|작은사발면|사발면|컵면|큰사발|작은사발|봉지|큰컵|작은컵|컵|용기)(?=\s|$)/g, ' ');
  if (slug === 'beer' || slug === 'soju') name = name.replace(/\s*(?:페트병|페트|캔|병)(?=\s|$)/g, ' ');
  return name.trim().replace(/\s+/g, ' ');
}

export function categoryRegistrationHint(slug?: string) {
  if (slug === 'ramen') return '맛은 구분하고, 봉지면·컵라면은 같은 제품으로 모아요.';
  if (slug === 'beer') return '제품 종류·무알코올 여부는 구분하고, 캔·병·용량은 합쳐요.';
  if (slug === 'soju') return '제품 종류는 구분하고, 병·페트·용량은 합쳐요.';
  if (slug === 'snacks') return '제품명·맛은 구분하고, 포장 크기·묶음 수량은 합쳐요.';
  return '같은 제품이 있는지 먼저 확인하고, 제품명과 세부 종류를 정확히 적어주세요.';
}
