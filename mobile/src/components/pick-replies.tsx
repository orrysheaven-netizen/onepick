import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { profileDisplayName, profileNickname } from '@/lib/profile/profileName';
import { CurrentPickFlag } from '@/components/current-pick-flag';
import { ReportAction } from '@/components/report-action';
import { DIALOG_CLOSE_LABEL } from '@/components/ui/dialog-labels';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateComment } from '@/hooks/useCreateComment';
import { useDeleteComment } from '@/hooks/useDeleteComment';
import { usePickComments } from '@/hooks/usePickComments';
import { OnePick } from '@/constants/onepick';
import type { CommentReadItem, ReadCursor } from '@/repositories/interfaces/readRepository';

function getCommentErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'COMMENT_INVALID') return '댓글은 1~300자로 입력해주세요.';
    if (error.code === 'COMMENT_PARENT_INVALID') return '답글을 달 댓글이 바뀌었어요. 새로고침 후 다시 시도해주세요.';
    if (error.code === 'RATE_LIMITED') return '댓글 요청이 많아요. 1분 후 다시 시도해주세요.';
    if (error.code === 'AUTH_REQUIRED') return '댓글을 남기려면 로그인이 필요해요.';
    if (error.code === 'FORBIDDEN') return '지금은 이 Pick에 댓글을 남길 수 없어요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '댓글을 남기려면 사용자명을 먼저 정해주세요.';
  }

  return '댓글을 저장하지 못했어요. 다시 시도해주세요.';
}

/**
 * `compact` embeds the thread in a review card: no card frame, no empty-state line,
 * and the composer stays behind a small "댓글 쓰기" until the reader asks for it.
 * `canWrite` is the viewer-scoped item_review_page.can_comment permission.
 */
export function PickReplies({ pickId, compact = false, canWrite = true, focusCommentId, initialCursor = null, onFocusLoaded }: {
  pickId: string;
  compact?: boolean;
  canWrite?: boolean;
  focusCommentId?: string;
  initialCursor?: ReadCursor | null;
  onFocusLoaded?: () => void;
}) {
  const auth = useAuthSession();
  // Drafts, pending requests and mutation errors belong to one account/thread.
  return <RepliesContent key={`${auth.user?.id ?? 'anonymous'}:${pickId}:${focusCommentId ?? ''}`} auth={auth} pickId={pickId}
    compact={compact} canWrite={canWrite} focusCommentId={focusCommentId} initialCursor={initialCursor} onFocusLoaded={onFocusLoaded} />;
}

function RepliesContent({ auth, pickId, compact, canWrite, focusCommentId, initialCursor, onFocusLoaded }: {
  auth: ReturnType<typeof useAuthSession>;
  pickId: string;
  compact: boolean;
  canWrite: boolean;
  focusCommentId?: string;
  initialCursor: ReadCursor | null;
  onFocusLoaded?: () => void;
}) {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = auth;
  const commentsQuery = usePickComments(!isSessionLoading && !sessionError ? pickId : undefined, user?.id, initialCursor);
  const createComment = useCreateComment(pickId ?? 'missing');
  const deleteComment = useDeleteComment(pickId ?? 'missing');
  // One inline confirmation at a time; native Alert does not exist on web.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [composing, setComposing] = useState(!compact);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string } | null>(null);
  const submittingComment = useRef(false);
  // The caller passes the authoritative viewer-scoped item_review_page.can_comment.
  // Server RLS still enforces the same rule on every insert.
  const canComment = canWrite && !isSessionLoading && !sessionError;

  const focusedCommentLoaded = Boolean(focusCommentId && commentsQuery.data?.some(({ comment }) => comment.id === focusCommentId));
  useEffect(() => {
    if (focusedCommentLoaded) onFocusLoaded?.();
  }, [focusedCommentLoaded, onFocusLoaded]);

  const trimmedComment = commentBody.trim();
  const canSubmitComment = trimmedComment.length >= 1 && trimmedComment.length <= 300;

  const handleCommentSubmit = async () => {
    if (!pickId || !user || !canComment || !canSubmitComment || createComment.isPending || submittingComment.current) {
      return;
    }

    submittingComment.current = true;
    try {
      await createComment.mutateAsync({
        userId: user.id,
        body: trimmedComment,
        parentCommentId: replyingTo?.id ?? null,
      });
      setCommentBody('');
      setReplyingTo(null);
      if (compact) setComposing(false);
    } catch {
      // Keep the draft; mutation state shows the failure and allows retry.
    } finally {
      submittingComment.current = false;
    }
  };

  const handleCommentDelete = async (commentId: string) => {
    if (deleteComment.isPending) return;
    try {
      await deleteComment.mutateAsync(commentId);
      setConfirmingDeleteId(null);
      if (replyingTo?.id === commentId) setReplyingTo(null);
    } catch {
      // Keep the confirmation open; mutation state shows the failure and allows retry.
    }
  };

  const threadCount = (commentsQuery.data ?? []).reduce((sum, entry) => {
    const replies = entry.replies ?? [];
    return sum + (entry.comment.isDeleted ? 0 : 1)
      + replies.filter((reply) => !reply.comment.isDeleted).length;
  }, 0);

  const renderComment = (entry: CommentReadItem, isReply: boolean) => {
    const { comment, author } = entry;
    const deleted = Boolean(comment.isDeleted);
    const canDelete = Boolean(comment.canDelete ?? (user && comment.userId === user.id));
    // #804: nickname when set, otherwise @username; routes keep the username.
    const username = author ? profileDisplayName(author) : '사용자';
    const authorLabel = author ? profileNickname(author) ?? `@${author.username}` : '사용자';

    return <View key={comment.id} style={[
      styles.commentRow,
      isReply && styles.replyRow,
      comment.id === focusCommentId && styles.commentHighlight,
    ]}>
      <View style={[styles.commentAvatar, isReply && styles.replyAvatar]}>
        <Text style={styles.commentAvatarText}>{deleted ? '·' : username.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.commentCopy}>
        {deleted ? <Text style={styles.commentAuthor}>삭제된 댓글</Text> : author ? <View style={styles.commentAuthorRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${authorLabel} 공개 프로필 보기`}
            onPress={() => router.push({ pathname: '/u/[username]', params: { username: author.username, returnTo: `/pick/${pickId}` } })}
            style={({ pressed }) => [styles.commentAuthorLink, pressed && styles.pressed]}>
            <Text style={styles.commentAuthor}>{authorLabel} ›</Text>
          </Pressable>
          {comment.authorCurrentPickMatchesItem ? <CurrentPickFlag mine={author.id === user?.id} /> : null}
        </View> : <Text style={styles.commentAuthor}>사용자</Text>}

        <Text style={[styles.commentBody, deleted && styles.deletedBody]}>{deleted ? '삭제된 댓글이에요.' : comment.body}</Text>

        {!deleted && user && author && author.id !== user.id ? <View style={styles.commentSafety}>
          <ReportAction reporterUserId={user.id} targetType="comment" targetId={comment.id} />
        </View> : null}

        {!isReply && canComment && !deleted ? <Pressable accessibilityRole="button"
          accessibilityLabel={`@${username}에게 답글 달기`}
          onPress={() => {
            setReplyingTo({ id: comment.id, username });
            setComposing(true);
            createComment.reset();
          }}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
          <Text style={styles.textActionLabel}>답글</Text>
        </Pressable> : null}

        {canDelete ? (confirmingDeleteId === comment.id ? <View style={styles.deleteConfirm}>
          <Text style={styles.deleteConfirmText}>이 댓글을 삭제할까요? 답글이 있으면 대화 자리는 남아요.</Text>
          {deleteComment.isError ? <Text accessibilityRole="alert" style={styles.commentError}>댓글을 삭제하지 못했어요. 다시 시도해주세요.</Text> : null}
          <View style={styles.deleteActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="댓글 삭제하기" disabled={deleteComment.isPending}
              onPress={() => void handleCommentDelete(comment.id)}
              style={({ pressed }) => [styles.deleteButton, deleteComment.isPending && styles.commentButtonDisabled, pressed && styles.pressed]}>
              {deleteComment.isPending ? <ActivityIndicator color={OnePick.onAccent} size="small" /> : <Text style={styles.deleteButtonText}>댓글 삭제하기</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="댓글 삭제 확인 닫기" disabled={deleteComment.isPending}
              onPress={() => { setConfirmingDeleteId(null); deleteComment.reset(); }}
              style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
              <Text style={styles.textActionLabel}>{DIALOG_CLOSE_LABEL}</Text>
            </Pressable>
          </View>
        </View> : <Pressable accessibilityRole="button" accessibilityLabel="내 댓글 삭제" disabled={deleteComment.isPending}
          onPress={() => { deleteComment.reset(); setConfirmingDeleteId(comment.id); }}
          style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
          <Text style={styles.textActionLabel}>삭제</Text>
        </Pressable>) : null}
      </View>
    </View>;
  };

  if (isSessionLoading) return <ActivityIndicator accessibilityLabel="로그인 상태 확인 중" />;
  if (sessionError) return <View style={styles.commentsState}>
    <Text accessibilityRole="alert" style={styles.commentsStateText}>로그인 상태를 확인하지 못했어요.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="로그인 상태 다시 확인" onPress={retrySession} style={styles.smallButton}>
      <Text style={styles.smallButtonText}>다시 확인하기</Text>
    </Pressable>
  </View>;
  return (
            <View style={compact ? styles.commentsInline : styles.commentsCard}>
              {!compact || commentsQuery.data?.length ? <View style={styles.commentsHeader}>
                <Text style={compact ? styles.commentsTitleCompact : styles.commentsTitle}>댓글</Text>
                <Text style={styles.commentsCount}>{threadCount}개{commentsQuery.hasNextPage ? '+' : ''}</Text>
              </View> : null}

              {commentsQuery.isPending ? (
                <View style={styles.commentsState}>
                  <ActivityIndicator />
                  <Text style={styles.commentsStateText}>댓글을 불러오고 있어요.</Text>
                </View>
              ) : null}

              {commentsQuery.isError && !commentsQuery.isFetchNextPageError ? (
                <View style={styles.commentsState}>
                  <Text style={styles.commentsStateText}>댓글을 불러오지 못했어요.</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void commentsQuery.refetch()}
                    style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                    <Text style={styles.smallButtonText}>다시 불러오기</Text>
                  </Pressable>
                </View>
              ) : null}

              {!compact && !commentsQuery.isPending && !commentsQuery.isError && commentsQuery.data?.length === 0 ? (
                <Text style={styles.emptyComments}>{canComment ? '첫 댓글을 남겨보세요.' : '아직 댓글이 없어요.'}</Text>
              ) : null}

              {commentsQuery.data?.map((entry) => <View key={entry.comment.id}>
                {renderComment(entry, false)}
                {(entry.replies ?? []).map((reply) => renderComment(reply, true))}
              </View>)}

              {commentsQuery.isFetchNextPageError ? (
                <Text accessibilityRole="alert" style={styles.commentsStateText}>다음 댓글을 불러오지 못했어요. 다시 시도해주세요.</Text>
              ) : null}

              {commentsQuery.hasNextPage ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={commentsQuery.isFetching}
                  onPress={() => { if (!commentsQuery.isFetching) void commentsQuery.fetchNextPage({ cancelRefetch: false }); }}
                  style={({ pressed }) => [styles.smallButton, commentsQuery.isFetching && { opacity: 0.5 }, pressed && styles.pressed]}>
                  {commentsQuery.isFetchingNextPage ? <ActivityIndicator color={OnePick.onAccent} size="small" /> : <Text style={styles.smallButtonText}>{commentsQuery.isFetchNextPageError ? '댓글 더 보기 다시 시도' : '댓글 더 보기'}</Text>}
                </Pressable>
              ) : null}

              {canComment && !composing ? (
                <Pressable accessibilityRole="button" accessibilityLabel="댓글 쓰기" onPress={() => {
                  setReplyingTo(null);
                  setComposing(true);
                  createComment.reset();
                }}
                  style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
                  <Text style={styles.textActionLabel}>댓글 쓰기</Text>
                </Pressable>
              ) : canComment ? (
                user ? (
                  <View style={styles.commentComposer}>
                    <View style={styles.commentInputHeader}>
                      <Text style={styles.commentInputLabel}>{replyingTo ? `@${replyingTo.username}에게 답글` : '댓글 남기기'}</Text>
                      <Text style={styles.commentCounter}>{commentBody.length}/300</Text>
                    </View>
                    {replyingTo ? <Pressable accessibilityRole="button" accessibilityLabel="답글 취소"
                      onPress={() => setReplyingTo(null)} style={styles.replyCancel}>
                      <Text style={styles.textActionLabel}>답글 취소</Text>
                    </Pressable> : null}
                    <TextInput
                      accessibilityLabel={replyingTo ? '답글 입력' : '댓글 입력'}
                      editable={!createComment.isPending}
                      maxLength={300}
                      multiline
                      onChangeText={(value) => { if (!submittingComment.current) setCommentBody(value); }}
                      placeholder={replyingTo ? '답글을 남겨보세요.' : '이 원픽에 대해 이야기해보세요.'}
                      placeholderTextColor={OnePick.textSecondary}
                      style={styles.commentInput}
                      value={commentBody}
                    />
                    {createComment.isError ? (
                      <Text style={styles.commentError}>{getCommentErrorMessage(createComment.error)}</Text>
                    ) : null}
                    {createComment.error instanceof AppError && createComment.error.code === 'PROFILE_NOT_FOUND' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.push({ pathname: '/auth/username', params: { action: 'comment_pick', pickId } })}
                        style={styles.smallButton}>
                        <Text style={styles.smallButtonText}>사용자명 만들고 계속</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={!canSubmitComment || createComment.isPending}
                      onPress={() => void handleCommentSubmit()}
                      style={({ pressed }) => [
                        styles.commentButton,
                        (!canSubmitComment || createComment.isPending) && styles.commentButtonDisabled,
                        pressed && canSubmitComment && !createComment.isPending && styles.pressed,
                      ]}>
                      {createComment.isPending ? (
                        <ActivityIndicator color={OnePick.onAccent} />
                      ) : (
                        <Text style={styles.commentButtonText}>{replyingTo ? '답글 남기기' : '댓글 남기기'}</Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/auth/login', params: { action: 'comment_pick', pickId } })}
                    style={({ pressed }) => [styles.loginPrompt, pressed && styles.pressed]}>
                    <Text style={styles.loginPromptTitle}>로그인하고 댓글 남기기</Text>
                    <Text style={styles.loginPromptText}>원픽을 고른 이유에 대해 이야기를 나눠보세요.</Text>
                  </Pressable>
                )
              ) : compact ? null : (
                <Text style={styles.historyCommentNotice}>지금은 댓글을 남길 수 없는 한줄평이에요.</Text>
              )}
            </View>

  );
}

const styles = StyleSheet.create({
  commentAuthorLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentsCard: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 18, marginTop: 14 },
  commentsInline: { marginTop: 4 },
  commentsTitleCompact: { color: OnePick.muted, fontSize: 12, fontWeight: '800' },
  commentsHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  commentsTitle: { color: OnePick.text, fontSize: 16, fontWeight: '800' },
  commentsCount: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  commentsState: { alignItems: 'center', paddingVertical: 20 },
  commentsStateText: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  smallButton: { backgroundColor: OnePick.text, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 8, marginTop: 10 },
  smallButtonText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  emptyComments: { color: OnePick.muted, fontSize: 12, lineHeight: 18, paddingVertical: 17 },
  commentRow: { flexDirection: 'row', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: OnePick.border },
  replyRow: { marginLeft: 34, paddingLeft: 10, backgroundColor: OnePick.background, borderRadius: 12, borderBottomWidth: 0, marginTop: 4 },
  commentHighlight: { backgroundColor: OnePick.accentSoft, borderRadius: 12, paddingHorizontal: 8 },
  commentAvatar: { width: 34, height: 34, borderRadius: 12, backgroundColor: OnePick.sunken, alignItems: 'center', justifyContent: 'center' },
  replyAvatar: { width: 28, height: 28, borderRadius: 10 },
  commentAvatarText: { color: OnePick.muted, fontSize: 13, fontWeight: '900' },
  commentCopy: { flex: 1, marginLeft: 11 },
  commentAuthor: { color: OnePick.text, fontSize: 12, fontWeight: '800' },
  commentBody: { color: OnePick.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  deletedBody: { fontStyle: 'italic', color: OnePick.textSecondary },
  commentSafety: { marginTop: 8 },
  textAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 },
  textActionLabel: { color: OnePick.muted, fontSize: 12, fontWeight: '700' },
  replyCancel: { minHeight: 32, alignSelf: 'flex-start', justifyContent: 'center', marginBottom: 4 },
  deleteConfirm: { marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: OnePick.background },
  deleteConfirmText: { color: OnePick.text, fontSize: 12, lineHeight: 17 },
  deleteActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  deleteButton: { minHeight: 44, minWidth: 64, borderRadius: 12, paddingHorizontal: 14, backgroundColor: OnePick.danger, alignItems: 'center', justifyContent: 'center' },
  deleteButtonText: { color: OnePick.onAccent, fontSize: 12, fontWeight: '800' },
  commentComposer: { marginTop: 18 },
  commentInputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  commentInputLabel: { color: OnePick.text, fontSize: 12, fontWeight: '800' },
  commentCounter: { color: OnePick.textSecondary, fontSize: 12 },
  commentInput: { minHeight: 88, borderRadius: 15, backgroundColor: OnePick.background, paddingHorizontal: 13, paddingVertical: 12, color: OnePick.text, fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  commentError: { color: OnePick.danger, fontSize: 12, lineHeight: 17, marginTop: 8 },
  commentButton: { minHeight: 44, borderRadius: 14, backgroundColor: OnePick.accent, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  commentButtonDisabled: { opacity: 0.4 },
  commentButtonText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  loginPrompt: { backgroundColor: OnePick.background, borderRadius: 15, padding: 14, marginTop: 16 },
  loginPromptTitle: { color: OnePick.text, fontSize: 13, fontWeight: '800' },
  loginPromptText: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  historyCommentNotice: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 16 },
  pressed: { opacity: 0.7 },
});
