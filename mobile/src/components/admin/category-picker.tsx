import { useMemo } from 'react';

import { AdminSearchPicker } from '@/components/admin/search-picker';
import { categoryLabel } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';

type Props = {
  /** Every category, used to build "먹을것 › 빵 › 식빵" labels. */
  categories: Category[];
  /** The categories that may be chosen. */
  selectable: Category[];
  value: string | null;
  onChange: (categoryId: string) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function AdminCategoryPicker({ categories, selectable, value, onChange, disabled = false, accessibilityLabel = '카테고리 검색' }: Props) {
  const options = useMemo(
    () => selectable.map((category) => ({ id: category.id, label: categoryLabel(category, categories), name: category.name })),
    [categories, selectable],
  );
  return (
    <AdminSearchPicker
      options={options}
      value={value}
      onChange={(id) => { if (id) onChange(id); }}
      noun="카테고리"
      example="식빵, 라면"
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
