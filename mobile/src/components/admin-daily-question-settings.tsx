import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AdminCategoryPicker } from '@/components/admin/category-picker';
import { Button } from '@/components/ui';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useAdminDailyQuestionSettings, useUpdateAdminDailyQuestion } from '@/hooks/useAdminHomeSettings';
import { categoryLabel, categoryRootSlug, selectableCategories } from '@/lib/categories/categoryTree';

/** Mounted with a user key by AdminHomeSettings so drafts never cross accounts. */
export function AdminDailyQuestionSettings({ userId }: { userId?: string }) {
  const query = useAdminDailyQuestionSettings(userId);
  const mutation = useUpdateAdminDailyQuestion(userId);
  const [draft, setDraft] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const categories = query.data?.categories ?? [];
  const selectable = selectableCategories(categories)
    .filter((category) => categoryRootSlug(category, categories) === 'food');
  const selected = draft === undefined ? query.data?.categoryId ?? null : draft;
  const current = categories.find((category) => category.id === query.data?.categoryId);
  const invalidSelection = selected !== null && !selectable.some((category) => category.id === selected);
  const disabled = !userId || mutation.isPending || query.isError || query.data === undefined;
  const change = (categoryId: string | null) => {
    if (busy.current) return;
    setDraft(categoryId);
    setMessage('');
  };
  const save = async () => {
    if (disabled || busy.current || invalidSelection || selected === query.data?.categoryId) return;
    busy.current = true;
    setMessage('');
    try {
      await mutation.mutateAsync(selected);
      setDraft(undefined);
      setMessage(selected === null ? '홈 질문을 숨겼어요.' : '홈 질문 메뉴를 저장했어요.');
    } catch {
      setMessage('저장하지 못했어요. 선택한 메뉴를 유지했으니 다시 시도해주세요.');
    } finally { busy.current = false; }
  };

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.heading}>홈 질문 메뉴</Text>
    <Text style={styles.text}>질문할 맛집 메뉴를 선택해요. 저장하면 홈 질문에 반영해요.</Text>
    {query.isPending && userId ? <ActivityIndicator accessibilityLabel="홈 질문 메뉴를 불러오고 있어요" /> : null}
    {query.isError ? <>
      <Text accessibilityRole="alert" style={styles.text}>홈 질문 설정을 불러오지 못했어요.</Text>
      <Button variant="secondary" label="다시 불러와요" disabled={query.isFetching}
        onPress={() => { if (!query.isFetching) void query.refetch(); }} />
    </> : null}
    {query.data !== undefined ? <>
      <Text style={styles.text}>{query.data.categoryId === null
        ? '현재 홈 질문을 숨기고 있어요.'
        : current ? `현재 ${categoryLabel(current, categories)} 메뉴로 질문해요.`
          : '저장된 질문 메뉴를 확인할 수 없어요. 메뉴를 다시 선택하거나 질문을 숨겨주세요.'}</Text>
      <AdminCategoryPicker categories={categories} selectable={selectable} value={selected}
        onChange={change} disabled={disabled} accessibilityLabel="홈 질문 메뉴를 검색해요" />
      {!selectable.length ? <Text style={styles.text}>선택할 수 있는 맛집 메뉴가 없어요. 카테고리 설정을 확인해주세요.</Text> : null}
      {invalidSelection ? <Text accessibilityRole="alert" style={styles.text}>지금 질문할 수 없는 메뉴예요. 다른 메뉴를 선택하거나 질문을 숨겨주세요.</Text> : null}
      <Button variant="secondary" label="질문을 숨겨요" disabled={disabled || selected === null}
        onPress={() => change(null)} />
      <Button label={mutation.isPending ? '저장하고 있어요' : '질문 설정을 저장해요'}
        disabled={disabled || invalidSelection || selected === query.data.categoryId} onPress={() => void save()} />
    </> : null}
    {message ? <Text accessibilityRole="alert" style={styles.text}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: OnePick.bgDefault, borderWidth: 1, borderColor: OnePick.borderDefault,
    borderRadius: OnePickRadius.lg, padding: OnePickSpace.lg, marginVertical: OnePickSpace.md, gap: OnePickSpace.md },
  heading: { ...OnePickType.headline, color: OnePick.textPrimary },
  text: { ...OnePickType.body, color: OnePick.textSecondary },
});
