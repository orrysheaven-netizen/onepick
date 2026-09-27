import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { OnePick } from '@/constants/onepick';

const MAX_RESULTS = 8;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');

export type SearchPickerOption = {
  id: string;
  /** Shown on the chip and in the "선택:" line. */
  label: string;
  /** A match here ranks first; defaults to the label. */
  name?: string;
};

type Props = {
  options: SearchPickerOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** What is being picked, e.g. "카테고리" or "브랜드". */
  noun: string;
  /** Placeholder examples, e.g. "식빵, 라면". */
  example: string;
  /** When set, null is a valid choice shown with this label (e.g. "미지정"). */
  noneLabel?: string;
  disabled?: boolean;
  accessibilityLabel: string;
};

// Shows only the chosen option and matches for a typed query, instead of
// rendering every option as a chip.
export function AdminSearchPicker({ options, value, onChange, noun, example, noneLabel, disabled = false, accessibilityLabel }: Props) {
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.id === value) ?? null;

  const needle = normalize(query);
  const matches = useMemo(() => {
    if (!needle) return [];
    const nameMatches = (option: SearchPickerOption) => normalize(option.name ?? option.label).includes(needle);
    return options
      .filter((option) => normalize(option.label).includes(needle))
      .sort((a, b) => Number(!nameMatches(a)) - Number(!nameMatches(b)));
  }, [needle, options]);
  const shown = matches.slice(0, MAX_RESULTS);

  const choose = (id: string | null) => {
    onChange(id);
    setQuery('');
  };

  if (options.length === 0 && !noneLabel) return <Text style={adminStyles.muted}>선택 가능한 {noun}가 없습니다.</Text>;

  const summary = selected ? `선택: ${selected.label}` : noneLabel ? `선택: ${noneLabel}` : `선택된 ${noun}가 없습니다.`;

  return (
    <View style={styles.picker}>
      <View style={styles.summaryRow}>
        <Text style={selected || noneLabel ? styles.selected : adminStyles.muted}>{summary}</Text>
        {!!noneLabel && !!selected && (
          <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel} ${noneLabel}으로 변경`} disabled={disabled} onPress={() => choose(null)} style={[styles.choice, disabled && styles.disabled]}>
            <Text style={styles.choiceText}>{noneLabel}으로</Text>
          </Pressable>
        )}
      </View>
      {options.length > 0 && (
        <TextInput
          accessibilityLabel={accessibilityLabel}
          editable={!disabled}
          value={query}
          onChangeText={setQuery}
          placeholder={`${selected ? '변경하려면' : `예: ${example}`} ${noun} 이름 검색 (${options.length}개)`}
          style={adminStyles.input}
        />
      )}
      {!!needle && (
        <View style={adminStyles.row}>
          {shown.length === 0 && <Text style={adminStyles.muted}>일치하는 {noun}가 없습니다.</Text>}
          {shown.map(({ id, label }) => {
            const active = id === value;
            return (
              <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => choose(id)} style={[styles.choice, active && styles.choiceActive, disabled && styles.disabled]}>
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
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  selected: { color: OnePick.text, fontSize: 14, fontWeight: '700' },
  choice: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface },
  choiceActive: { backgroundColor: OnePick.text, borderColor: OnePick.text },
  choiceText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  choiceTextActive: { color: OnePick.onAccent },
  disabled: { opacity: 0.5 },
});
