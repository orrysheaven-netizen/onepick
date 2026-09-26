import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { categoryLabel } from '@/lib/categories/categoryTree';
import type { Category } from '@/types/domain/category';
import { OnePick } from '@/constants/onepick';

const MAX_RESULTS = 8;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');

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

// Shows only the chosen category and matches for a typed query, instead of
// rendering every selectable leaf as a chip.
export function AdminCategoryPicker({ categories, selectable, value, onChange, disabled = false, accessibilityLabel = '카테고리 검색' }: Props) {
  const [query, setQuery] = useState('');

  const options = useMemo(
    () => selectable.map((category) => ({ category, label: categoryLabel(category, categories) })),
    [categories, selectable],
  );
  const selected = options.find((option) => option.category.id === value) ?? null;

  const needle = normalize(query);
  const matches = useMemo(() => {
    if (!needle) return [];
    // A match on the leaf name itself ranks above a match on a parent segment.
    return options
      .filter((option) => normalize(option.label).includes(needle))
      .sort((a, b) => Number(!normalize(a.category.name).includes(needle)) - Number(!normalize(b.category.name).includes(needle)));
  }, [needle, options]);
  const shown = matches.slice(0, MAX_RESULTS);

  const choose = (categoryId: string) => {
    onChange(categoryId);
    setQuery('');
  };

  if (selectable.length === 0) return <Text style={adminStyles.muted}>선택 가능한 카테고리가 없습니다.</Text>;

  return (
    <View style={styles.picker}>
      <Text style={selected ? styles.selected : adminStyles.muted}>
        {selected ? `선택: ${selected.label}` : '선택된 카테고리가 없습니다.'}
      </Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        editable={!disabled}
        value={query}
        onChangeText={setQuery}
        placeholder={`${selected ? '변경하려면' : '예: 식빵, 라면'} 카테고리 이름 검색 (${selectable.length}개)`}
        style={adminStyles.input}
      />
      {!!needle && (
        <View style={adminStyles.row}>
          {shown.length === 0 && <Text style={adminStyles.muted}>일치하는 카테고리가 없습니다.</Text>}
          {shown.map(({ category, label }) => {
            const active = category.id === value;
            return (
              <Pressable key={category.id} accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => choose(category.id)} style={[styles.choice, active && styles.choiceActive, disabled && styles.disabled]}>
                <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
          {matches.length > shown.length && <Text style={adminStyles.muted}>외 {matches.length - shown.length}개 · 더 구체적으로 입력해 주세요.</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: 10 },
  selected: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  choice: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  choiceActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  choiceText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  choiceTextActive: { color: OnePick.onAccent },
  disabled: { opacity: 0.5 },
});
