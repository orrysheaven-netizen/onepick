import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import { Avatar } from './avatar';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

type Props = {
  review: string;
  username?: string;
  meta?: string;
  mine?: boolean;
  onPress?: () => void;
  onEdit?: () => void;
  onRemovePick?: () => void;
  onDelete?: () => void;
};

function Action({ label, onPress }: { label: string; onPress?: () => void }) {
  if (!onPress) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

export function ReviewRow({ review, username, meta, mine, onPress, onEdit, onRemovePick, onDelete }: Props) {
  const content = <>
    {!mine && username ? <Avatar name={username} size={32} tone="subtle" /> : null}
    <View style={styles.copy}>
      {username ? <Text style={styles.username}>{mine ? '내 한줄평' : '@' + username}</Text> : null}
      <Text style={styles.review}>{review}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {mine && (onEdit || onRemovePick || onDelete) ? (
        <View style={styles.actions}>
          <Action label="수정" onPress={onEdit} />
          <Action label="원픽 해제" onPress={onRemovePick} />
          <Action label="한줄평 삭제" onPress={onDelete} />
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
  username: { ...OnePickType.captionMedium, color: OnePick.textPrimary },
  review: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.xs },
  meta: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: OnePickSpace.xs, marginTop: OnePickSpace.sm },
  action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: OnePickSpace.xs },
  actionLabel: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  pressed: { opacity: PRESSED_OPACITY },
});
