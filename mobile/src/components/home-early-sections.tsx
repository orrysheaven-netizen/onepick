// Current Home integration (Figma 1058:9018, #762). Presentational only: Home decides what to show
// with lib/home/earlyHome and passes callbacks that reuse existing routes.
import type { ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Chip, Icon } from '@/components/ui';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from '@/components/ui/touch';
import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { HomeParticipant, QuestionFooter } from '@/lib/home/earlyHome';
import { homeQuestionTitle, homeQuestionSubtitle } from '@/lib/home/questionTitle';
import { profileDisplayName } from '@/lib/profile/profileName';
import type { Category } from '@/types/domain/category';

/** 834:4749 — shown only while unread replies exist. */
export function HomeReplyBanner({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`내 원픽에 새 답글 ${count}개 보기`} onPress={onPress}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
      <Text style={styles.bannerText} numberOfLines={1}>{`내 원픽에 새 답글 ${count}개`}</Text>
      <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
    </Pressable>
  );
}

type QuestionCardProps = {
  category: Category;
  /** Public nickname from #804; never use username or OAuth metadata as a name. */
  nickname?: string | null;
  /** null while the shared menu counts are still loading. */
  answerCount: number | null;
  answered: boolean;
  footer: QuestionFooter;
  onAnswer: () => void;
  onBrowseAnswers: () => void;
  /** The question photo opens this menu's list of everyone's Picks, before and after answering. */
  onOpenMenu: () => void;
  onShareFirstPick: () => void;
};

/** 1070:8278 — one question, with registration or same-menu discovery by Pick status. */
export function HomeQuestionCard({ category, nickname, answerCount, answered, footer, onAnswer, onBrowseAnswers, onOpenMenu, onShareFirstPick }: QuestionCardProps) {
  // 2026-10-11 두 줄 구성 확정: '다른 원픽을 남겨요' 보조 동작은 삭제. 첫 원픽 직후 공유 줄만 남음.
  const footerLabel = footer.kind === 'first-pick-done' ? '원픽 완료 · 친구에게 공유해요' : null;
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{homeQuestionTitle()}</Text>
      <Text style={styles.cardSubtitle}>{homeQuestionSubtitle(category.name, nickname)}</Text>
      {category.imageUrl ? <Pressable accessibilityRole="button" accessibilityLabel={`${category.name} 원픽 목록 보기`}
        onPress={onOpenMenu} style={({ pressed }) => [styles.cardImageAction, pressed && styles.pressed]}>
        <Image source={{ uri: category.imageUrl }} accessibilityLabel={`${category.name} 사진`}
          resizeMode="cover" style={styles.cardImage} />
      </Pressable> : null}
      {answerCount !== null ? <Text style={styles.cardCount}>{`${answerCount.toLocaleString()}명이 ${category.name} 원픽을 남겼어요.`}</Text> : null}
      <View style={styles.cardGap} />
      <Button fullWidth label={answered ? `다른 ${category.name} 원픽도 구경해요` : `내 ${category.name} 원픽을 남겨요`}
        accessibilityLabel={answered ? `다른 ${category.name} 원픽도 구경해요` : `${category.name} 원픽 답하기`}
        onPress={answered ? onBrowseAnswers : onAnswer} />
      {footerLabel ? <Pressable accessibilityRole="button" accessibilityLabel={footerLabel}
        onPress={onShareFirstPick}
        style={({ pressed }) => [styles.footerLink, pressed && styles.pressed]}>
        <Text style={styles.footerText}>{footerLabel}</Text>
        <Icon name="chevronRight" size="sm" color={OnePick.textPrimary} />
      </Pressable> : null}
    </View>
  );
}

/** 834:4756 — people with at least one Pick, most recent activity first. */
export function HomePeopleRow({ people, onOpenProfile }: { people: HomeParticipant[]; onOpenProfile: (username: string) => void }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>함께하는 사람들</Text>
        <Text style={styles.sectionAction}>{`${people.length}명`}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRow}>
        {people.map((person) => {
          // Shown name follows the #804 identification rule (nickname, else username);
          // the profile route keeps the username.
          const name = profileDisplayName(person);
          return <Pressable key={person.userId} accessibilityRole="button"
            accessibilityLabel={`${name} 프로필 보기, 원픽 ${person.pickCount}개`}
            onPress={() => onOpenProfile(person.username)}
            style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
            <Avatar name={name} size={64} tone="subtle" />
            <Text style={styles.personName} numberOfLines={1}>{name}</Text>
            <Text style={styles.personCount}>{`원픽 ${person.pickCount}`}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </View>
  );
}

/**
 * 834:4783 → 1203:8588 — menus nobody has picked yet (shown below 30 Picks in total).
 * 2026-10-11 confirmed two-line layout: one title line + one chip line (scrolls sideways when
 * the names are long). No description, no '다른 메뉴 찾아보기'. Chips keep the existing
 * menu-preselected registration route and 44px touch targets.
 */
export function HomeUnpickedMenus({ categories, onPick }: { categories: Category[]; onPick: (category: Category) => void }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle} numberOfLines={1}>아직 정하지 않은 원픽</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {categories.map((category) => <Chip key={category.id} label={category.name}
          accessibilityLabel={`${category.name} 첫 원픽 남기기`} onPress={() => onPick(category)} />)}
      </ScrollView>
    </View>
  );
}

/**
 * 834:4889 — invite through the existing profile share path, with the 의견 보내기 action
 * (#831 HomeFeedbackButton) beside it. The feedback element renders nothing while no public
 * address is configured, so the row then holds the invite button alone.
 */
export function HomeInviteRow({ onInvite, feedback }: { onInvite: () => void; feedback?: ReactNode }) {
  return (
    <View style={styles.inviteRow}>
      <Button variant="secondary" fullWidth label="친구 초대 링크" accessibilityLabel="친구 초대 링크 공유하러 가기" onPress={onInvite} style={styles.inviteButton} />
      {feedback ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: PRESSED_OPACITY },
  // 834:4749: bg/subtle, radius md, 14×13 padding, 10 between text and chevron.
  banner: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13, borderRadius: OnePickRadius.md, backgroundColor: OnePick.bgSubtle },
  bannerText: { ...OnePickType.bodyMedium, flex: 1, minWidth: 0, color: OnePick.textPrimary },
  // 305:799: white card, 1px border/default, radius lg, padding 24, 8 between rows.
  card: { gap: OnePickSpace.sm, padding: OnePickSpace.xxl, borderWidth: 1, borderColor: OnePick.borderDefault, borderRadius: OnePickRadius.lg, backgroundColor: OnePick.bgDefault },
  cardTitle: { ...OnePickType.pageTitle, color: OnePick.textSecondary, textAlign: 'center' },
  cardSubtitle: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  // The 2:1 photo is far taller than the 44px minimum touch target at any card width.
  cardImageAction: { width: '100%', minHeight: MIN_TOUCH_TARGET },
  cardImage: { width: '100%', aspectRatio: 2, borderRadius: OnePickRadius.md },
  cardCount: { ...OnePickType.body, color: OnePick.textSecondary },
  cardGap: { height: OnePickSpace.sm },
  // Text button 284:263: 40 visual height, 44 touch area.
  footerLink: { minHeight: MIN_TOUCH_TARGET, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.xs, alignSelf: 'flex-start', justifyContent: 'center' },
  footerText: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  section: { gap: OnePickSpace.md },
  sectionHeader: { height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...OnePickType.headline, flex: 1, minWidth: 0, color: OnePick.textPrimary },
  sectionAction: { ...OnePickType.caption, color: OnePick.textSecondary },
  peopleRow: { gap: 14, paddingRight: OnePickSpace.xs },
  person: { width: 64, alignItems: 'center', gap: OnePickSpace.xs },
  personName: { ...OnePickType.captionMedium, maxWidth: 64, color: OnePick.textPrimary },
  // Figma 30E uses text/tertiary here; Foundations reserves tertiary for non-copy (test-tertiary-usage), so secondary.
  personCount: { ...OnePickType.caption, color: OnePick.textSecondary },
  // 1203:8592: one row, 6 between chips (Figma), no wrap.
  chipRow: { flexDirection: 'row', gap: 6, paddingRight: OnePickSpace.xs },
  inviteRow: { flexDirection: 'row', gap: 10 },
  inviteButton: { flex: 1 },
});


