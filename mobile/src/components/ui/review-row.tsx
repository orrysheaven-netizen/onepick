import type { GestureResponderEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';
import { Avatar } from './avatar';
import { CurrentPickFlag } from './current-pick-flag';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

type Props = {
  review: string;
  username?: string;
  meta?: string;
  mine?: boolean;
  currentPick?: boolean;
  commentsLabel?: string;
  onPress?: () => void;
  onComments?: () => void;
  onShare?: () => void;
  onReport?: () => void;
  onEdit?: () => void;
  onRemovePick?: () => void;
  onDelete?: () => void;
};

function Action({ label, onPress, danger }: { label: string; onPress?: () => void; danger?: boolean }) {
  if (!onPress) return null;
  const press = (event: GestureResponderEvent) => {
    event.stopPropagation?.();
    onPress();
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={press}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Text style={[styles.actionLabel, danger && styles.actionDanger]}>{label}</Text>
    </Pressable>
  );
}

export function ReviewRow({
  review, username, meta, mine, currentPick, commentsLabel = '댓글',
  onPress, onComments, onShare, onReport, onEdit, onRemovePick, onDelete,
}: Props) {
  const content = <>
    {!mine && username ? <Avatar name={username} size={32} tone="subtle" /> : null}
    <View style={styles.copy}>
      <View style={styles.identity}>
        {mine ? <View style={styles.mineTag}><Text style={styles.mineTagText}>내 한줄평</Text></View>
          : username ? <Text style={styles.username}>@{username}</Text> : null}
        {currentPick ? <CurrentPickFlag /> : null}
      </View>
      <Text style={styles.review}>{review}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {(onComments || onShare || onReport || (mine && (onEdit || onRemovePick || onDelete))) ? (
        <View style={styles.actions}>
          <Action label={commentsLabel} onPress={onComments} />
          <Action label="공유" onPress={onShare} />
          {mine ? <>
            <Action label="수정" onPress={onEdit} />
            <Action label="원픽 해제" onPress={onRemovePick} />
            <Action label="한줄평 삭제" onPress={onDelete} danger />
          </> : <Action label="신고" onPress={onReport} danger />}
        </View>
      ) : null}
    </View>
  </>;

  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'flex-start', gap: OnePickSpace.md, paddingVertical: OnePickSpace.md },
  copy: { flex: 1, minWidth: 0 },
  identity: { minHeight: 24, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: OnePickSpace.sm },
  username: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  mineTag: { minHeight: 24, justifyContent: 'center', borderRadius: OnePickRadius.sm, backgroundColor: OnePick.bgAccentSubtle, paddingHorizontal: OnePickSpace.sm },
  mineTagText: { ...OnePickType.captionMedium, color: OnePick.textAccent },
  review: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.xs },
  meta: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', columnGap: OnePickSpace.xs, rowGap: 0, marginTop: OnePickSpace.sm },
  action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: OnePickSpace.xs },
  actionLabel: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  actionDanger: { color: OnePick.textDanger },
  pressed: { opacity: PRESSED_OPACITY },
});
