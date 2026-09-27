import { useMemo } from 'react';

import { AdminSearchPicker } from '@/components/admin/search-picker';
import type { AdminBrand } from '@/lib/admin-api';

type Props = {
  /** Active brands only; null means "미지정". */
  brands: AdminBrand[];
  value: string | null;
  onChange: (brandId: string | null) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function AdminBrandPicker({ brands, value, onChange, disabled = false, accessibilityLabel = '브랜드 검색' }: Props) {
  const options = useMemo(() => brands.map((brand) => ({ id: brand.id, label: brand.name })), [brands]);
  return (
    <AdminSearchPicker
      options={options}
      value={value}
      onChange={onChange}
      noun="브랜드"
      example="Apple, 농심"
      noneLabel="미지정"
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
