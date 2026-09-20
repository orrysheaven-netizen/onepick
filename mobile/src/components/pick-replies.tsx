import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ReportAction } from '@/components/report-action';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateComment } from '@/hooks/useCreateComment';
import { usePickComments } from '@/hooks/usePickComments';
import { usePickDetail } from '@/hooks/usePickDetail';

function getCommentErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'COMMENT_INVALID') return '답글은 1~300자로 입력해주세요.';
    if (error.code === 'RATE_LIMITED') return '답글 요청이 많아요. 1분 후 다시 시도해주세요.';
    if (error.code === 'AUTH_REQUIRED') return '답글을 남기려면 로그인이 필요해요.';
    if (error.code === 'FORBIDDEN') return '지금은 이 Pick에 답글을 남길 수 없어요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '답글을 남기려면 사용자명을 먼저 정해주세요.';
  }

  return '답글을 저장하지 못했어요. 다시 시도해주세요.';
}

export function PickReplies({ pickId }: { pickId: string }) {
  const auth = useAuthSession();
  // Drafts, pending requests and mutation errors belong to one account/thread.
  return <RepliesContent key={`${auth.user?.id ?? 'anonymous'}:${pickId}`} auth={auth} pickId={pickId} />;
}

function RepliesContent({ auth, pickId }: { auth: ReturnType<typeof useAuthSession>; pickId: string }) {
  const router = useRouter();
  const { user, isLoading: isSessionLoading, error: sessionError, retry: retrySession } = auth;
  const query = usePickDetail(pickId, user?.id);
  const commentsQuery = usePickComments(!isSessionLoading && !sessionError ? pickId : undefined, user?.id);
  const createComment = useCreateComment(pickId ?? 'missing');
  const [commentBody, setCommentBody] = useState('');
  const submittingComment = useRef(false);
  const canComment = !isSessionLoading && !sessionError && !query.isError && query.data?.pick.status === 'active';

  const trimmedComment = commentBody.trim();
  const canSubmitComment = trimmedComment.length >= 1 && trimmedComment.length <= 300;

  const handleCommentSubmit = async () => {
    if (!pickId || !user || !canComment || !canSubmitComment || createComment.isPending || submittingComment.current) {
      return;
    }

    submittingComment.current = true;
    try {
      await createComment.mutateAsync({ userId: user.id, body: trimmedComment });
      setCommentBody('');
    } catch {
      // Keep the draft; mutation state shows the failure and allows retry.
    } finally {
      submittingComment.current = false;
    }
  };

  if (isSessionLoading) return <ActivityIndicator accessibilityLabel="로그인 상태 확인 중" />;
  if (sessionError) return <View style={styles.commentsState}>
    <Text accessibilityRole="alert" style={styles.commentsStateText}>로그인 상태를 확인하지 못했어요.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="로그인 상태 다시 확인" onPress={retrySession} style={styles.smallButton}>
      <Text style={styles.smallButtonText}>다시 확인하기</Text>
    </Pressable>
  </View>;
  if (query.isPending) return <ActivityIndicator accessibilityLabel="답글 불러오는 중" />;
  if (query.isError || !query.data) return (
    <View><Text>한줄평을 불러오지 못했어요.</Text><Pressable onPress={() => void query.refetch()}><Text>다시 불러오기</Text></Pressable></View>
  );

  return (
            <View style={styles.commentsCard}>
              <View style={styles.commentsHeader}>
                <Text style={styles.commentsTitle}>답글</Text>
                <Text style={styles.commentsCount}>{commentsQuery.data?.length ?? 0}개{commentsQuery.hasNextPage ? '+' : ''}</Text>
              </View>

              {commentsQuery.isPending ? (
                <View style={styles.commentsState}>
                  <ActivityIndicator />
                  <Text style={styles.commentsStateText}>답글을 불러오고 있어요</Text>
                </View>
              ) : null}

              {commentsQuery.isError && !commentsQuery.isFetchNextPageError ? (
                <View style={styles.commentsState}>
                  <Text style={styles.commentsStateText}>답글을 불러오지 못했어요.</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void commentsQuery.refetch()}
                    style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                    <Text style={styles.smallButtonText}>다시 불러오기</Text>
                  </Pressable>
                </View>
              ) : null}

              {!commentsQuery.isPending && !commentsQuery.isError && commentsQuery.data?.length === 0 ? (
                <Text style={styles.emptyComments}>{canComment ? '아직 답글이 없어요. 첫 의견을 남겨보세요.' : '아직 답글이 없어요.'}</Text>
              ) : null}

              {commentsQuery.data?.map(({ comment, author }) => (
                <View key={comment.id} style={styles.commentRow}>
                  <View style={styles.commentAvatar}>
                    <Text style={styles.commentAvatarText}>
                      {(author?.username ?? '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.commentCopy}>
                    {author ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`@${author.username} 공개 프로필 보기`}
                        onPress={() => router.push({ pathname: '/u/[username]', params: { username: author.username } })}
                        style={({ pressed }) => [styles.commentAuthorLink, pressed && styles.pressed]}>
                        <Text style={styles.commentAuthor}>@{author.username} ›</Text>
                      </Pressable>
                    ) : <Text style={styles.commentAuthor}>사용자</Text>}
                    <Text style={styles.commentBody}>{comment.body}</Text>
                    {user && author && author.id !== user.id ? (
                      <View style={styles.commentSafety}>
                        <ReportAction reporterUserId={user.id} targetType="comment" targetId={comment.id} />
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}

              {commentsQuery.isFetchNextPageError ? (
                <Text accessibilityRole="alert" style={styles.commentsStateText}>다음 답글을 불러오지 못했어요. 다시 시도해주세요.</Text>
              ) : null}

              {commentsQuery.hasNextPage ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={commentsQuery.isFetching}
                  onPress={() => { if (!commentsQuery.isFetching) void commentsQuery.fetchNextPage({ cancelRefetch: false }); }}
                  style={({ pressed }) => [styles.smallButton, commentsQuery.isFetching && { opacity: 0.5 }, pressed && styles.pressed]}>
                  {commentsQuery.isFetchingNextPage ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.smallButtonText}>{commentsQuery.isFetchNextPageError ? '답글 더 보기 다시 시도' : '답글 더 보기'}</Text>}
                </Pressable>
              ) : null}

              {canComment ? (
                user ? (
                  <View style={styles.commentComposer}>
                    <View style={styles.commentInputHeader}>
                      <Text style={styles.commentInputLabel}>답글 남기기</Text>
                      <Text style={styles.commentCounter}>{commentBody.length}/300</Text>
                    </View>
                    <TextInput
                      accessibilityLabel="답글 입력"
                      editable={!createComment.isPending}
                      maxLength={300}
                      multiline
                      onChangeText={(value) => { if (!submittingComment.current) setCommentBody(value); }}
                      placeholder="이 원픽에 대해 이야기해보세요"
                      placeholderTextColor="#89909C"
                      style={styles.commentInput}
                      value={commentBody}
                    />
                    {createComment.isError ? (
                      <Text style={styles.commentError}>{getCommentErrorMessage(createComment.error)}</Text>
                    ) : null}
                    {createComment.error instanceof AppError && createComment.error.code === 'PROFILE_NOT_FOUND' ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => router.push({ pathname: '/auth/username', params: { action: 'comment_pick', pickId: query.data.pick.id } })}
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
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.commentButtonText}>답글 남기기</Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: '/auth/login', params: { action: 'comment_pick', pickId: query.data.pick.id } })}
                    style={({ pressed }) => [styles.loginPrompt, pressed && styles.pressed]}>
                    <Text style={styles.loginPromptTitle}>로그인하고 답글 남기기</Text>
                    <Text style={styles.loginPromptText}>원픽을 고른 이유에 대해 이야기를 나눠보세요.</Text>
                  </Pressable>
                )
              ) : (
                <Text style={styles.historyCommentNotice}>
                  {query.data.pick.status === 'needs_review' ? '확인이 필요한 원픽에는 새 답글을 남길 수 없습니다.' : '현재 답글을 남길 수 없는 원픽입니다.'}
                </Text>
              )}
            </View>

  );
}

const styles = StyleSheet.create({
  commentAuthorLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  commentsCard: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginTop: 14 },
  commentsHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 },
  commentsTitle: { color: '#202124', fontSize: 16, fontWeight: '800' },
  commentsCount: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  commentsState: { alignItems: 'center', paddingVertical: 20 },
  commentsStateText: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 8 },
  smallButton: { backgroundColor: '#202124', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 8, marginTop: 10 },
  smallButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  emptyComments: { color: '#747985', fontSize: 12, lineHeight: 18, paddingVertical: 17 },
  commentRow: { flexDirection: 'row', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E3E5EA' },
  commentAvatar: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#ECEEF3', alignItems: 'center', justifyContent: 'center' },
  commentAvatarText: { color: '#5F5A54', fontSize: 13, fontWeight: '900' },
  commentCopy: { flex: 1, marginLeft: 11 },
  commentAuthor: { color: '#202124', fontSize: 12, fontWeight: '800' },
  commentBody: { color: '#5F5A54', fontSize: 13, lineHeight: 19, marginTop: 4 },
  commentSafety: { marginTop: 8 },
  commentComposer: { marginTop: 18 },
  commentInputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  commentInputLabel: { color: '#202124', fontSize: 12, fontWeight: '800' },
  commentCounter: { color: '#89909C', fontSize: 12 },
  commentInput: { minHeight: 88, borderRadius: 15, backgroundColor: '#F5F6F8', paddingHorizontal: 13, paddingVertical: 12, color: '#202124', fontSize: 13, lineHeight: 19, textAlignVertical: 'top' },
  commentError: { color: '#A9482D', fontSize: 12, lineHeight: 17, marginTop: 8 },
  commentButton: { minHeight: 44, borderRadius: 14, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  commentButtonDisabled: { opacity: 0.4 },
  commentButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  loginPrompt: { backgroundColor: '#F5F6F8', borderRadius: 15, padding: 14, marginTop: 16 },
  loginPromptTitle: { color: '#202124', fontSize: 13, fontWeight: '800' },
  loginPromptText: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 4 },
  historyCommentNotice: { color: '#747985', fontSize: 12, lineHeight: 17, marginTop: 16 },
  pressed: { opacity: 0.7 },
});
