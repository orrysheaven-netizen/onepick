import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { OnePickBrand } from '@/components/onepick-brand';
import { Button } from '@/components/ui';
import { MIN_TOUCH_TARGET } from '@/components/ui/touch';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { useItemSearch } from '@/hooks/useItemSearch';

const searchIcon = require('../../public/icons/search.svg');

/**
 * Home header: English wordmark and search button.
 * The theme selector stays hidden while only one public theme is available; re-expose
 * it when members can actually choose between at least two public themes.
 */
export function HomeHeader({ onOpenItem }: { onOpenItem: (itemId: string) => void }) {
  const [dialog, setDialog] = useState<'search' | null>(null);
  const close = () => setDialog(null);
  return <View style={styles.header}>
    <View style={styles.side}><OnePickBrand /></View>
    <View pointerEvents="box-none" style={[styles.side, styles.sideEnd]}>
      <Pressable accessibilityRole="button" accessibilityLabel="메뉴 검색" onPress={() => setDialog('search')}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <Image source={searchIcon} alt="" style={styles.icon} contentFit="contain" />
      </Pressable>
    </View>



    {dialog === 'search' ? <HomeSearchDialog onClose={close} onOpenItem={(itemId) => { close(); onOpenItem(itemId); }} /> : null}
  </View>;
}

function HomeSearchDialog({ onClose, onOpenItem }: { onClose: () => void; onOpenItem: (itemId: string) => void }) {
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState('');
  const query = useItemSearch(submitted);
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
            placeholder="메뉴명을 입력하세요" placeholderTextColor={OnePick.hint} style={styles.input} />
          {text ? <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => setText('')} style={styles.clear}>
            <Text style={styles.clearText}>✕</Text>
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
            const meta = [item.creatorName, item.collectionName].filter(Boolean).join(' · ');
            return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name} 상세 보기`}
              onPress={() => onOpenItem(item.id)} style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
              {thumb ? <Image source={{ uri: thumb }} alt="" style={styles.thumb} contentFit="cover" />
                : <View style={[styles.thumb, styles.thumbEmpty]} />}
              <View style={styles.resultCopy}>
                <Text numberOfLines={1} style={styles.resultName}>{item.name}</Text>
                {meta ? <Text numberOfLines={1} style={styles.resultMeta}>{meta}</Text> : null}
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>;
          })}
        </ScrollView> : null}

        <Button label="검색" onPress={search} disabled={!normalized} fullWidth />
        <Button variant="ghost" label="닫기" onPress={onClose} fullWidth />
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: OnePickSpace.sm, position: 'relative' },
  side: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  sideEnd: { alignItems: 'flex-end' },
  iconButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 24, height: 24 },
  pressed: { opacity: 0.65 },
  backdrop: { flex: 1, justifyContent: 'center', padding: OnePickSpace.gutter, backgroundColor: OnePick.bgOverlay },
  dialog: { width: '100%', maxWidth: 420, maxHeight: '90%', alignSelf: 'center', gap: OnePickSpace.md, padding: OnePickSpace.xl, borderRadius: OnePickRadius.xl, backgroundColor: OnePick.bgDefault },
  title: { ...OnePickType.title, color: OnePick.textPrimary },
  text: { ...OnePickType.body, color: OnePick.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgMuted },
  input: { ...OnePickType.body, flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: OnePickSpace.lg, color: OnePick.textPrimary },
  clear: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  clearText: { ...OnePickType.bodyMedium, color: OnePick.textSecondary },
  state: { alignItems: 'center', gap: OnePickSpace.sm, paddingVertical: OnePickSpace.sm, textAlign: 'center' },
  results: { flexGrow: 0, maxHeight: 280 },
  result: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, paddingVertical: OnePickSpace.sm, borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault },
  thumb: { width: 48, height: 48, borderRadius: OnePickRadius.sm },
  thumbEmpty: { backgroundColor: OnePick.bgPlaceholder },
  resultCopy: { flex: 1, minWidth: 0 },
  resultName: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  resultMeta: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: 2 },
  arrow: { ...OnePickType.title, color: OnePick.textSecondary },
});
