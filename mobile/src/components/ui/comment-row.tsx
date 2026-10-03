import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import { Avatar } from './avatar';
import { CurrentPickFlag } from './current-pick-flag';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

type Props = {
  username: string;
  body: string;
  time: string;
  reply?: boolean;
  currentPick?: boolean;
  showReply?: boolean;
  onReply?: () => void;
  onProfilePress?: () => void;
};

export function CommentRow({ username, body, time, reply, currentPick, showReply = true, onReply, onProfilePress }: Props) {
  const canReply = Boolean(showReply && onReply);
  return (
    <View style={[styles.row, reply && styles.reply]}>
      <Avatar name={username} size={reply ? 24 : 32} tone="subtle" onPress={onProfilePress} />
      <View style={styles.copy}>
        <View style={styles.top}>
          <Text style={styles.username}>@{username}</Text>
          {currentPick ? <CurrentPickFlag /> : null}
        </View>
        <Text style={styles.body}>{body}</Text>
        <View style={[styles.metaRow, canReply && styles.metaRowInteractive]}>
          <Text style={styles.time}>{time}</Text>
          {canReply ? (
            <Pressable accessibilityRole="button" accessibilityLabel={username + '에게 답글'}
              onPress={onReply} style={({ pressed }) => [styles.replyAction, pressed && styles.pressed]}>
              <Text style={styles.replyLabel}>답글</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: OnePickSpace.sm, paddingVertical: OnePickSpace.md },
  reply: { marginLeft: 40 },
  copy: { flex: 1, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: OnePickSpace.sm },
  username: { ...OnePickType.bodyMedium, color: OnePick.textPrimary },
  body: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.sm },
  metaRowInteractive: { minHeight: MIN_TOUCH_TARGET },
  time: { ...OnePickType.caption, color: OnePick.textSecondary },
  replyAction: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: OnePickSpace.xs },
  replyLabel: { ...OnePickType.captionMedium, color: OnePick.textSecondary },
  pressed: { opacity: PRESSED_OPACITY },
});
