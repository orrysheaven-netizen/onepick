import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CurrentPickFlag } from '@/components/current-pick-flag';
import { PickManagement, PickManagementActions, type PickManagementMode } from '@/components/pick-management';
import { PickReplies } from '@/components/pick-replies';
import { PickShareActions } from '@/components/pick-share-actions';
import { Avatar } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { ReadCursor } from '@/repositories/interfaces/readRepository';
import type { Pick } from '@/types/domain/pick';
import type { Profile } from '@/types/domain/profile';
import { OnePick } from '@/constants/onepick';


/** Where an inline thread should open: a notification or comment-list target. */
export type ReviewThreadFocus = {
  commentId?: string;
  initialCursor?: ReadCursor | null;
  onLoaded?: () => void;
};

/**
 * One review row on an item. Review body and comment count expand the thread
 * right here — recent comments, "댓글 N개 더 보기" and the composer — instead
 * of opening a separate conversation screen (user decision 2026-10-04).
 */
export function ItemReviewCard({ pick, profile, categoryName, itemName, itemId, highlighted, onRemoved, initiallyExpanded = false, threadFocus }: {
  pick: Pick; profile: Profile | null; categoryName: string; itemName: string; itemId: string;
  highlighted: boolean; onRemoved: () => void; initiallyExpanded?: boolean; threadFocus?: ReviewThreadFocus;
}) {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const isMine = user?.id === pick.userId;
  const isCurrent = pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review');
  const isDeleted = pick.isDeleted ?? false;
  const canManage = !isLoading && (pick.canManage ?? (isMine && isCurrent)) && !isDeleted;
  const commentCount = pick.commentCount ?? 0;
  const [manageMode, setManageMode] = useState<PickManagementMode>('idle');
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const toggleThread = () => setExpanded((value) => !value);

  return (
    <View style={[styles.card, isMine && isCurrent && styles.mine, highlighted && styles.highlight]}>
      <View style={styles.header}>
        {isMine ? (
          <Text style={[styles.author, styles.mineLabel]}>내 한줄평</Text>
        ) : <>
          <Avatar name={profile?.username ?? '?'} size={24} />
          <View style={styles.author}>
            {profile ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`@${profile.username} 공개 프로필 보기`}
                onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username, returnTo: `/item/${itemId}` } })} style={styles.profileLink}>
                <Text numberOfLines={1} style={styles.username}>@{profile.username}</Text>
              </Pressable>
            ) : <Text style={styles.username}>사용자</Text>}
          </View>
        </>}
        {isCurrent ? <CurrentPickFlag /> : null}
        {canManage ? <PickManagementActions onOpen={setManageMode} /> : null}
        <PickShareActions authorUserId={pick.userId} categoryName={categoryName} oneLineReview={pick.oneLineReview}
          pickId={pick.id} itemName={itemName} username={profile?.username ?? '사용자'} />
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={itemName + (expanded ? ' 한줄평 댓글 접기' : ' 한줄평 댓글 펼치기')} onPress={toggleThread}
        style={({ pressed }) => pressed && styles.pressed}>
        {isDeleted ? <Text style={styles.history}>삭제된 한줄평입니다. 기존 대화만 남아 있어요.</Text>
          : <Text style={[styles.review, isMine && styles.myReview]}>“{pick.oneLineReview}”</Text>}
      </Pressable>
      {canManage ? (
        <PickManagement pick={pick} categoryName={categoryName} onRemoved={onRemoved} mode={manageMode} onModeChange={setManageMode} />
      ) : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={itemName + ' 댓글 ' + commentCount + (expanded ? '개 접기' : '개 보기')} onPress={toggleThread}
        style={({ pressed }) => [styles.commentLink, pressed && styles.pressed]}>
        <Text style={styles.commentLinkText}>{'댓글 ' + commentCount + (expanded ? ' · 접기' : '')}</Text>
      </Pressable>
      {expanded ? (
        <PickReplies pickId={pick.id} canWrite={Boolean(pick.canComment)}
          preview={{ limit: 3, totalCount: commentCount }}
          readOnlyNotice="이 지점의 메뉴를 원픽으로 고르면 댓글과 답글을 쓸 수 있어요."
          focusCommentId={threadFocus?.commentId} initialCursor={threadFocus?.initialCursor ?? null} onFocusLoaded={threadFocus?.onLoaded} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OnePick.border,
    backgroundColor: 'transparent',
    paddingVertical: 16,
  },
  mine: { backgroundColor: 'transparent' },
  highlight: { backgroundColor: OnePick.accentSoft, borderRadius: 14, paddingHorizontal: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { flex: 1, minWidth: 0 },
  mineLabel: { color: OnePick.accentDeep, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  username: { color: OnePick.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  profileLink: { minHeight: 36, justifyContent: 'center' },
  review: { color: OnePick.text, fontSize: 15, lineHeight: 22, marginVertical: 10 },
  myReview: { fontWeight: '600' },
  history: { color: OnePick.muted, fontSize: 12, lineHeight: 16, marginVertical: 10 },
  commentLink: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingRight: 12 },
  commentLinkText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
