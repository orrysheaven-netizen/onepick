import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PickManagement, PickManagementActions, type PickManagementMode } from '@/components/pick-management';
import { PickReplies } from '@/components/pick-replies';
import { PickShareActions } from '@/components/pick-share-actions';
import { Avatar } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { Pick } from '@/types/domain/pick';
import type { Profile } from '@/types/domain/profile';
import { OnePick } from '@/constants/onepick';

/**
 * One review on an item. Other people's threads are always open so the conversation
 * is visible; my own review keeps its replies behind "댓글 보기" and carries the
 * small 수정 · 해제 actions where the 내 원픽 badge used to be.
 */
export function ItemReviewCard({ pick, profile, categoryName, itemName, focused, highlighted, onRemoved }: {
  pick: Pick; profile: Profile | null; categoryName: string; itemName: string;
  focused: boolean; highlighted: boolean; onRemoved: () => void;
}) {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const isMine = user?.id === pick.userId;
  const isCurrent = pick.status === 'active' || pick.status === 'needs_review';
  const canManage = !isLoading && isMine && isCurrent;
  const [repliesOpen, setRepliesOpen] = useState(focused || !isMine);
  const [manageMode, setManageMode] = useState<PickManagementMode>('idle');
  useEffect(() => { if (focused || !isMine) setRepliesOpen(true); }, [focused, isMine]);

  return (
    <View style={[styles.card, isMine && isCurrent && styles.mine, highlighted && styles.highlight]}>
      <View style={styles.header}>
        {isMine ? (
          <Text style={[styles.author, styles.mineLabel]}>{isCurrent ? '내 한줄평' : '내 이전 한줄평'}</Text>
        ) : <>
          <Avatar name={profile?.username ?? '?'} size={24} />
          <View style={styles.author}>
            {profile ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`@${profile.username} 공개 프로필 보기`}
                onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username } })} style={styles.profileLink}>
                <Text numberOfLines={1} style={styles.username}>@{profile.username}</Text>
              </Pressable>
            ) : <Text style={styles.username}>사용자</Text>}
          </View>
          {!isCurrent ? <Text style={styles.history}>이전 원픽</Text> : null}
        </>}
        {canManage ? <PickManagementActions onOpen={setManageMode} /> : null}
        <PickShareActions authorUserId={pick.userId} categoryName={categoryName} oneLineReview={pick.oneLineReview}
          pickId={pick.id} itemName={itemName} username={profile?.username ?? '사용자'} />
      </View>
      <Text style={[styles.review, isMine && styles.myReview]}>“{pick.oneLineReview}”</Text>
      {!isCurrent ? <Text style={styles.history}>현재 선택이 종료된 한줄평입니다. 기존 댓글은 계속 볼 수 있어요.</Text> : null}
      {canManage ? (
        <PickManagement pick={pick} categoryName={categoryName} onRemoved={onRemoved} mode={manageMode} onModeChange={setManageMode} />
      ) : null}
      {isMine ? (
        <Pressable accessibilityRole="button" onPress={() => setRepliesOpen((open) => !open)}
          style={({ pressed }) => [styles.repliesToggle, pressed && styles.pressed]}>
          <Text style={styles.repliesToggleText}>{repliesOpen ? '댓글 숨기기' : '댓글 보기'}</Text>
        </Pressable>
      ) : null}
      {/* Keep the mounted thread while collapsed so an unfinished reply is preserved. */}
      <ReplyThread pickId={pick.id} open={repliesOpen} />
    </View>
  );
}

function ReplyThread({ pickId, open }: { pickId: string; open: boolean }) {
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  return open || visited ? <View style={!open ? { display: 'none' } : undefined}><PickReplies pickId={pickId} compact /></View> : null;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 16, marginBottom: 12 },
  mine: { backgroundColor: OnePick.accentSoft, borderColor: OnePick.accentSoft },
  highlight: { borderColor: OnePick.accent, borderWidth: 2, backgroundColor: OnePick.accentSoft },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { flex: 1, minWidth: 0 },
  mineLabel: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  username: { color: OnePick.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  profileLink: { minHeight: 36, justifyContent: 'center' },
  review: { color: OnePick.text, fontSize: 15, lineHeight: 22, marginVertical: 10 },
  myReview: { fontWeight: '600' },
  history: { color: OnePick.muted, fontSize: 12, lineHeight: 16 },
  repliesToggle: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  repliesToggleText: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
