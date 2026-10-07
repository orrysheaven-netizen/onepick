import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { OnePickBrand } from '@/components/onepick-brand';
import { Button, Icon } from '@/components/ui';
import { MIN_TOUCH_TARGET } from '@/components/ui/touch';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useExploreCategories } from '@/hooks/useExploreData';
import { useItemSearch } from '@/hooks/useItemSearch';

// Figma 30-1 icons (search 656:3466, theme chevron 303:420, input clear 514:2856) now come
// from the shared OnePick / Icon set: search 24 (md), chevron 16 (sm), clear 16 (sm).

/**
 * Home header (Figma 30-1): English wordmark, the 맛집 theme button and a search button.
 * 맛집 is the only theme for now; the theme dialog just says so. Search reuses the
 * existing item search and opens a result the same way the old home search did.
 */
export function HomeHeader({ onOpenItem }: { onOpenItem: (itemId: string) => void }) {
  const [dialog, setDialog] = useState<'theme' | 'search' | null>(null);
  const close = () => setDialog(null);
  return <View style={styles.header}>
    <View style={styles.side}><OnePickBrand /></View>
    {/* Centered on the screen (Figma 30-1), independent of the logo's width. */}
    <View pointerEvents="box-none" style={styles.center}>
      <Pressable accessibilityRole="button" accessibilityLabel="테마 선택, 현재 맛집" onPress={() => setDialog('theme')}
        style={({ pressed }) => [styles.themeTouch, pressed && styles.pressed]}>
        <View style={styles.themeButton}>
          <Text style={styles.themeText}>맛집</Text>
          <Icon name="chevronDown" size="sm" color={OnePick.textPrimary} />
        </View>
      </Pressable>
    </View>
    <View pointerEvents="box-none" style={[styles.side, styles.sideEnd]}>
      <Pressable accessibilityRole="button" accessibilityLabel="메뉴 검색" onPress={() => setDialog('search')}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Icon name="search" color={OnePick.textPrimary} />
      </Pressable>
    </View>

    <Modal visible={dialog === 'theme'} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="테마 선택 닫기" onPress={close} style={StyleSheet.absoluteFill} />
        <View style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>테마 선택</Text>
          <Text style={styles.text}>다른 테마는 준비 중이에요.</Text>
          <View accessibilityRole="radio" accessibilityState={{ selected: true }} style={styles.themeOption}>
            <Text style={styles.themeOptionText}>맛집 ✓</Text>
          </View>
          <CloseButton onPress={close} />
        </View>
      </View>
    </Modal>

    {dialog === 'search' ? <HomeSearchDialog onClose={close} onOpenItem={(itemId) => { close(); onOpenItem(itemId); }} /> : null}
  </View>;
}

/** Figma Button / 닫기 (656:3479): 44-high white text button, Body Medium. */
function CloseButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onPress}
    style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
    <Text style={styles.closeText}>닫기</Text>
  </Pressable>;
}

function HomeSearchDialog({ onClose, onOpenItem }: { onClose: () => void; onOpenItem: (itemId: string) => void }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState('');
  const query = useItemSearch(submitted);
  // Result rows read "store (bold) menu"; the menu is the item's category (shared cached tree).
  const categories = useExploreCategories();
  const menuNames = useMemo(() => new Map((categories.data ?? []).map((category) => [category.id, category.name])), [categories.data]);
  const normalized = text.trim().replace(/\s+/g, ' ');
  const search = () => { if (normalized) setSubmitted(normalized); };
  const loading = query.hasSearchText && (query.isWaiting || query.isPending);
  const results = query.hasSearchText && !loading && !query.isError ? query.data ?? [] : null;

  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="메뉴 검색 닫기" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={styles.dialog}>
        <Text accessibilityRole="header" style={styles.title}>어떤 메뉴를 찾으세요?</Text>
        <View style={styles.inputRow}>
          <TextInput accessibilityLabel="메뉴명" autoFocus autoCapitalize="none" autoCorrect={false} maxLength={100}
            value={text} onChangeText={setText} onSubmitEditing={search} returnKeyType="search"
            placeholder="예: 라멘" placeholderTextColor={OnePick.textSecondary} style={styles.input} />
          {text ? <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setText('')} style={styles.clear}>
            <Icon name="clear" size="sm" color={OnePick.textTertiary} />
          </Pressable> : null}
        </View>

        {loading ? <View style={styles.state}><ActivityIndicator color={OnePick.accent} /><Text style={styles.text}>검색하고 있어요.</Text></View> : null}
        {query.hasSearchText && !loading && query.isError ? <View style={styles.state}>
          <Text accessibilityRole="alert" style={styles.text}>검색 결과를 불러오지 못했어요.</Text>
          <Button variant="ghost" size="sm" label="다시 검색하기" onPress={() => void query.refetch()} />
        </View> : null}
        {results && !results.length ? <Text accessibilityLiveRegion="polite" style={[styles.text, styles.state]}>
          ‘{submitted}’ 메뉴를 찾지 못했어요.
        </Text> : null}
        {results?.length ? <ScrollView style={styles.results} keyboardShouldPersistTaps="handled">
          {results.map((item) => {
            const thumb = item.thumbnailUrl ?? item.imageUrl;
            const menuName = menuNames.get(item.categoryId);
            return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name} 상세 보기`}
              onPress={() => onOpenItem(item.id)} style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
              {thumb ? <Image source={{ uri: thumb }} alt="" style={styles.thumb} contentFit="cover" />
                : <View style={[styles.thumb, styles.thumbEmpty]} />}
              <View style={styles.resultCopy}>
                <Text numberOfLines={1} style={styles.resultName}>
                  <Text style={styles.resultStore}>{item.name}</Text>{menuName ? ` ${menuName}` : ''}
                </Text>
              </View>
              <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
            </Pressable>;
          })}
        </ScrollView> : null}

        <Button label="검색하기" onPress={search} disabled={!normalized} fullWidth />
        <CloseButton onPress={onClose} />
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: OnePickSpace.sm, position: 'relative' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  side: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  sideEnd: { alignItems: 'flex-end' },
  themeTouch: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  // Figma Theme Selector (303:418): Title 20 + 16 chevron (icon/size/sm), 4 apart, padding 12×4, radius 12, bg/muted.
  themeButton: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.xs, paddingHorizontal: OnePickSpace.md, paddingVertical: OnePickSpace.xs, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgMuted },
  themeText: { ...OnePickType.title, color: OnePick.textPrimary },
  iconButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: OnePick.bgOverlay },
  // Figma 30-1A/B/C popups: radius 16, padding 20×24, 16 between parts.
  dialog: { width: '100%', maxWidth: 420, maxHeight: '90%', alignSelf: 'center', gap: OnePickSpace.lg, paddingHorizontal: 20, paddingVertical: 24, borderRadius: OnePickRadius.lg, backgroundColor: OnePick.bgDefault },
  title: { ...OnePickType.title, color: OnePick.textPrimary },
  text: { ...OnePickType.body, color: OnePick.textSecondary },
  themeOption: { height: 52, justifyContent: 'center', paddingHorizontal: OnePickSpace.lg, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgSubtle },
  themeOptionText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  // Figma Input (285:261): 52 high, bg/subtle, no border, left 16 / right 4, clear 16 (icon/size/sm) in a 44 target.
  inputRow: { height: 52, flexDirection: 'row', alignItems: 'center', paddingRight: OnePickSpace.xs, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgSubtle },
  input: { ...OnePickType.body, flex: 1, minWidth: 0, height: 52, paddingLeft: OnePickSpace.lg, color: OnePick.textPrimary },
  clear: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', gap: OnePickSpace.sm, paddingVertical: OnePickSpace.sm, textAlign: 'center' },
  results: { flexGrow: 0, maxHeight: 304 },
  // Figma Menu Row (508:2345): 76 high, 56 photo (radius 12), 12 apart, bottom rule.
  result: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault },
  thumb: { width: 56, height: 56, borderRadius: OnePickRadius.md },
  thumbEmpty: { backgroundColor: OnePick.bgPlaceholder },
  resultCopy: { flex: 1, minWidth: 0 },
  resultName: { ...OnePickType.body, fontSize: 16, lineHeight: 24, color: OnePick.textPrimary },
  resultStore: { fontWeight: '700' },
  closeButton: { height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: OnePickRadius.md },
  closeText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
});
