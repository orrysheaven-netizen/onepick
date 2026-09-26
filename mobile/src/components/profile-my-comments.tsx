import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, StateCard } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import type { useMyComments } from '@/hooks/useMyProfileLists';
import { formatRelativeTime } from '@/lib/format/relativeTime';
import type { MyCommentReadItem } from '@/repositories/interfaces/readRepository';

/**
 * The profile's "내 댓글" tab: comments I wrote, newest first, each with the review
 * it answers. A row opens the item screen focused on that review, where the thread
 * (and its 삭제 control) opens automatically.
 */
export function ProfileMyComments({ query }: { query: ReturnType<typeof useMyComments> }) {
  const router = useRouter();
  const comments = query.data ?? [];

  if (query.isPending) return <StateCard loading title="내 댓글을 불러오고 있어요" />;
  if (query.isError && !query.data) {
    return <StateCard tone="danger" title="내 댓글을 불러오지 못했어요" text="연결 상태를 확인한 뒤 다시 시도해주세요."
      action={{ label: '다시 불러오기', variant: 'secondary', disabled: query.isFetching, onPress: () => void query.refetch({ cancelRefetch: false }) }} />;
  }
  if (comments.length === 0) {
    return <StateCard title="아직 남긴 댓글이 없어요" text="상세 화면의 한줄평에서 댓글 쓰기를 눌러 이야기를 나눠보세요." />;
  }

  // Straight to the item screen: the /pick/[pickId] redirect would add a blank lookup screen first.
  const openReview = (itemId: string, pickId: string) => router.push({ pathname: '/item/[itemId]', params: { itemId, pickId } });
  return (
    <View>
      {comments.map((entry) => <MyCommentRow key={entry.comment.id} entry={entry} onOpen={openReview} />)}
      {query.isFetchNextPageError ? <Text accessibilityRole="alert" style={styles.error}>다음 댓글을 불러오지 못했어요.</Text> : null}
      {query.hasNextPage ? (
        <Button variant="secondary" size="sm" style={styles.more} accessibilityLabel="내 댓글 더 보기"
          disabled={query.isFetching} label={query.isFetchingNextPage ? '불러오는 중…' : query.isFetchNextPageError ? '다시 불러오기' : '내 댓글 더 보기'}
          onPress={() => { if (!query.isFetching) void query.fetchNextPage({ cancelRefetch: false }); }} />
      ) : null}
    </View>
  );
}

function MyCommentRow({ entry, onOpen }: { entry: MyCommentReadItem; onOpen: (itemId: string, pickId: string) => void }) {
  const { comment, pick, pickAuthor, item } = entry;
  const context = pick
    ? `${item?.name ?? '원픽'} · ${pickAuthor ? `@${pickAuthor.username}` : '사용자'}의 한줄평`
    : '볼 수 없는 한줄평';
  const copy = <>
    <Text numberOfLines={1} style={styles.context}>{context}</Text>
    {pick ? <Text numberOfLines={1} style={styles.review}>“{pick.oneLineReview}”</Text> : null}
    <Text style={styles.body}>{comment.body}</Text>
    <Text style={styles.time}>{formatRelativeTime(comment.createdAt)}{pick ? ' · 댓글 보기 ›' : ''}</Text>
  </>;
  if (!pick) return <View style={styles.row}>{copy}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${context}에 남긴 댓글 보기`} onPress={() => onOpen(pick.itemId, pick.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {copy}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, marginBottom: 9 },
  context: { color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  review: { color: OnePick.hint, fontSize: 12, lineHeight: 17, marginTop: 4 },
  body: { color: OnePick.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  time: { color: OnePick.hint, fontSize: 11, marginTop: 8 },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 17, marginTop: 4 },
  more: { marginTop: 4 },
  pressed: { opacity: 0.7 },
});
