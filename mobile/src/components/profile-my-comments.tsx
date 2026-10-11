import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, StateCard } from '@/components/ui';
import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import type { useMyComments } from '@/hooks/useMyProfileLists';
import { formatRelativeTime } from '@/lib/format/relativeTime';
import { itemTitle } from '@/lib/items/itemTitle';
import type { MyCommentReadItem } from '@/repositories/interfaces/readRepository';
import { commentService } from '@/services';

/**
 * The "댓글" tab's list: comments I wrote, newest first, each with the review
 * it answers. A row opens the item screen focused on that review, where the thread
 * (and its 삭제 control) opens automatically.
 */
export function ProfileMyComments({ query, emptyText, menuNames, restaurant = false }: {
  query: ReturnType<typeof useMyComments>;
  emptyText?: string;
  /** category id → menu name, for "매장명 메뉴명" titles. */
  menuNames?: Map<string, string>;
  restaurant?: boolean;
}) {
  const router = useRouter();
  const comments = query.data ?? [];

  if (query.isPending) return <StateCard loading title="댓글을 불러오고 있어요." />;
  if (query.isError && !query.data) {
    return <StateCard tone="danger" title="댓글을 불러오지 못했어요." text="연결 상태를 확인한 뒤 다시 시도해주세요."
      action={{ label: '다시 불러오기', variant: 'secondary', disabled: query.isFetching, onPress: () => void query.refetch({ cancelRefetch: false }) }} />;
  }
  if (comments.length === 0) {
    return <StateCard title="아직 남긴 댓글이 없어요." text={emptyText ?? '한줄평에 댓글을 남기면 여기에 모여요.'} />;
  }

  const openReview = async (entry: MyCommentReadItem) => {
    if (!entry.pick || !entry.item) return;
    try {
      const location = await commentService.locateComment(entry.comment.id);
      if (location) {
        router.push({ pathname: '/pick/[pickId]', params: {
          pickId: location.pickId,
          itemId: location.itemId,
          focusCommentId: entry.comment.id,
          ...(location.pageCursor ? {
            commentAfterTime: location.pageCursor.timestamp,
            commentAfterId: location.pageCursor.id,
          } : {}),
        } });
        return;
      }
    } catch {
      // Fall through to the review conversation when exact comment location fails.
    }
    router.push({ pathname: '/pick/[pickId]', params: { pickId: entry.pick.id, itemId: entry.item.id } });
  };
  return (
    <View>
      {comments.map((entry) => <MyCommentRow key={entry.comment.id} entry={entry}
        title={entry.item ? itemTitle(entry.item.name, menuNames?.get(entry.item.categoryId), restaurant) : '원픽'}
        onOpen={() => { void openReview(entry); }} />)}
      {query.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.error}>다음 댓글을 불러오지 못했어요.</Text> : null}
      {query.hasNextPage ? (
        <Button variant="secondary" size="sm" style={styles.more} accessibilityLabel="댓글 더 보기"
          disabled={query.isFetching} label={query.isFetchingNextPage ? '불러오는 중…' : query.isFetchNextPageError ? '다시 불러오기' : '댓글 더 보기'}
          onPress={() => { if (!query.isFetching) void query.fetchNextPage({ cancelRefetch: false }); }} />
      ) : null}
    </View>
  );
}

function MyCommentRow({ entry, title, onOpen }: { entry: MyCommentReadItem; title: string; onOpen: () => void }) {
  const { comment, pick, pickAuthor } = entry;
  const context = pick
    ? `${title} ${pickAuthor ? `@${pickAuthor.username}` : '사용자'}의 한줄평`
    : '볼 수 없는 한줄평';
  const copy = <>
    <Text numberOfLines={1} style={styles.context}>{context}</Text>
    {pick ? <Text numberOfLines={1} style={styles.review}>“{pick.oneLineReview}”</Text> : null}
    <Text style={styles.body}>{comment.body}</Text>
    <Text style={styles.time}>{formatRelativeTime(comment.createdAt)}{pick ? ' 댓글 보기 ›' : ''}</Text>
  </>;
  if (!pick) return <View style={styles.row}>{copy}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${context}에 남긴 댓글 보기`} onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {copy}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault, paddingVertical: OnePickSpace.md },
  context: { ...OnePickType.caption, color: OnePick.textSecondary },
  review: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.xs },
  body: { ...OnePickType.body, color: OnePick.textPrimary, marginTop: OnePickSpace.sm },
  time: { ...OnePickType.caption, color: OnePick.textSecondary, marginTop: OnePickSpace.sm },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 17, marginTop: 4 },
  more: { marginTop: 4 },
  pressed: { opacity: 0.7 },
});
