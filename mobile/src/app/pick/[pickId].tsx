import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickShareCard } from '@/components/pick-share-card';
import { PickManagement } from '@/components/pick-management';
import { PickPhoto } from '@/components/pick-photo';
import { ReportAction } from '@/components/report-action';
import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useCreateComment } from '@/hooks/useCreateComment';
import { usePickComments } from '@/hooks/usePickComments';
import { usePickDetail } from '@/hooks/usePickDetail';

function getCommentErrorMessage(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'COMMENT_INVALID') return '댓글은 1~300자로 입력해주세요.';
    if (error.code === 'AUTH_REQUIRED') return '댓글을 남기려면 로그인이 필요해요.';
    if (error.code === 'FORBIDDEN') return '지금은 이 Pick에 댓글을 남길 수 없어요.';
    if (error.code === 'PROFILE_NOT_FOUND') return '댓글을 남기려면 사용자명을 먼저 정해주세요.';
  }

  return '댓글을 저장하지 못했어요. 다시 시도해주세요.';
}

export default function PickDetailScreen() {
  const router = useRouter();
  const { pickId } = useLocalSearchParams<{ pickId?: string }>();
  const { user, isLoading: isSessionLoading } = useAuthSession();
  const query = usePickDetail(pickId, user?.id);
  const commentsQuery = usePickComments(pickId);
  const createComment = useCreateComment(pickId ?? 'missing');
  const [commentBody, setCommentBody] = useState('');
  const submittingComment = useRef(false);
  const canComment = !query.isError && query.data?.pick.status === 'active';

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        {query.isPending ? (
          <View style={styles.stateCard}>
            <ActivityIndicator />
            <Text style={styles.stateText}>원픽을 불러오고 있어요</Text>
          </View>
        ) : null}

        {!query.isPending && (query.isError || !query.data) ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitle}>원픽을 볼 수 없어요</Text>
            <Text style={styles.stateText}>삭제되었거나 볼 수 없는 기록일 수 있어요.</Text>
          </View>
        ) : null}

        {query.data ? (
          <>
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{query.data.profile.username.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`@${query.data.profile.username} 공개 프로필 보기`}
                onPress={() => router.push({ pathname: '/u/[username]', params: { username: query.data.profile.username } })}
                style={({ pressed }) => [styles.profileCopy, pressed && styles.pressed]}>
                <Text style={styles.eyebrow}>PICK BY</Text>
                <Text style={styles.username}>@{query.data.profile.username}</Text>
                <Text style={styles.profileLink}>다른 원픽 보기 ›</Text>
              </Pressable>
              <View style={[styles.statusBadge, !query.data.isCurrent && styles.statusBadgeMuted]}>
                <Text style={[styles.statusText, !query.data.isCurrent && styles.statusTextMuted]}>
                  {query.data.isCurrent ? '현재 원픽' : '이전 원픽'}
                </Text>
              </View>
            </View>

            <View style={styles.heroCard}>
              <PickPhoto uri={query.data.product.imageUrl} label={query.data.product.name} large />
              <Text style={styles.category}>{query.data.category.name}</Text>
              <Text style={styles.productName}>{query.data.product.name}</Text>
              <Text style={styles.review}>“{query.data.pick.oneLineReview}”</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/product/[productId]', params: { productId: query.data.product.id } })}
                style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                <Text style={styles.smallButtonText}>제품 상세 보기</Text>
              </Pressable>
            </View>

            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>선택 기록</Text>
              <Text style={styles.metaText}>
                {query.data.isCurrent
                  ? '지금 이 사용자가 선택한 원픽입니다.'
                  : query.data.pick.status === 'replaced'
                    ? '다른 원픽으로 변경되어 이전 기록으로 남아 있습니다.'
                    : '선택이 종료되어 이전 기록으로 남아 있습니다.'}
              </Text>
            </View>

            {!isSessionLoading && user?.id === query.data.pick.userId && query.data.isCurrent ? (
              <PickManagement
                key={`${user.id}:${query.data.pick.id}`}
                pick={query.data.pick}
                categoryName={query.data.category.name}
                onRemoved={() => router.replace('/')}
              />
            ) : null}

            <View style={styles.commentsCard}>
              <View style={styles.commentsHeader}>
                <Text style={styles.commentsTitle}>댓글</Text>
                <Text style={styles.commentsCount}>{commentsQuery.data?.length ?? 0}개</Text>
              </View>

              {commentsQuery.isPending ? (
                <View style={styles.commentsState}>
                  <ActivityIndicator />
                  <Text style={styles.commentsStateText}>댓글을 불러오고 있어요</Text>
                </View>
              ) : null}

              {commentsQuery.isError ? (
                <View style={styles.commentsState}>
                  <Text style={styles.commentsStateText}>댓글을 불러오지 못했어요.</Text>
                  <Pressable
                    onPress={() => void commentsQuery.refetch()}
                    style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                    <Text style={styles.smallButtonText}>다시 불러오기</Text>
                  </Pressable>
                </View>
              ) : null}

              {commentsQuery.data?.length === 0 ? (
                <Text style={styles.emptyComments}>{canComment ? '아직 댓글이 없어요. 첫 의견을 남겨보세요.' : '아직 댓글이 없어요.'}</Text>
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

              {commentsQuery.hasNextPage ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={commentsQuery.isFetchingNextPage}
                  onPress={() => void commentsQuery.fetchNextPage()}
                  style={({ pressed }) => [styles.smallButton, commentsQuery.isFetchingNextPage && { opacity: 0.5 }, pressed && styles.pressed]}>
                  {commentsQuery.isFetchingNextPage ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.smallButtonText}>댓글 더 보기</Text>}
                </Pressable>
              ) : null}

              {canComment ? (
                user ? (
                  <View style={styles.commentComposer}>
                    <View style={styles.commentInputHeader}>
                      <Text style={styles.commentInputLabel}>댓글 남기기</Text>
                      <Text style={styles.commentCounter}>{commentBody.length}/300</Text>
                    </View>
                    <TextInput
                      accessibilityLabel="댓글 입력"
                      editable={!createComment.isPending}
                      maxLength={300}
                      multiline
                      onChangeText={setCommentBody}
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
                        <Text style={styles.commentButtonText}>댓글 남기기</Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => router.push({ pathname: '/auth/login', params: { action: 'comment_pick', pickId: query.data.pick.id } })}
                    style={({ pressed }) => [styles.loginPrompt, pressed && styles.pressed]}>
                    <Text style={styles.loginPromptTitle}>로그인하고 댓글 남기기</Text>
                    <Text style={styles.loginPromptText}>원픽을 고른 이유에 대해 이야기를 나눠보세요.</Text>
                  </Pressable>
                )
              ) : (
                <Text style={styles.historyCommentNotice}>
                  {query.data.pick.status === 'needs_review' ? '확인이 필요한 원픽에는 새 댓글을 남길 수 없습니다.' : '현재 댓글을 남길 수 없는 원픽입니다.'}
                </Text>
              )}
            </View>

            <PickShareCard
              authorUserId={query.data.pick.userId}
              categoryName={query.data.category.name}
              oneLineReview={query.data.pick.oneLineReview}
              pickId={query.data.pick.id}
              productName={query.data.product.name}
              username={query.data.profile.username}
            />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  profileRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginBottom: 22 },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#252B38', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 19, fontWeight: '900' },
  profileCopy: { flex: 1, marginLeft: 12 },
  eyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.8 },
  username: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 4 },
  profileLink: { color: '#4945ED', fontSize: 12, marginTop: 5 },
  commentAuthorLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  statusBadge: { borderRadius: 999, backgroundColor: '#EFEEFF', paddingHorizontal: 11, paddingVertical: 7 },
  statusBadgeMuted: { backgroundColor: '#E3E5EA' },
  statusText: { color: '#4945ED', fontSize: 12, fontWeight: '800' },
  statusTextMuted: { color: '#747985' },
  heroCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 26, padding: 28 },
  productIcon: { width: 116, height: 116, borderRadius: 28, backgroundColor: '#F8F9FB', alignItems: 'center', justifyContent: 'center' },
  productEmoji: { fontSize: 56 },
  category: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.3, marginTop: 22 },
  productName: { color: '#202124', fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  review: { color: '#5F5A54', fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 22 },
  metaCard: { backgroundColor: '#252B38', borderRadius: 20, padding: 18, marginTop: 14 },
  metaLabel: { color: '#C7C4FF', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  metaText: { color: '#FFFFFF', fontSize: 13, lineHeight: 20, marginTop: 8 },
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
  stateCard: { alignItems: 'center', borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 22, padding: 28, marginTop: 34 },
  stateTitle: { color: '#202124', fontSize: 18, fontWeight: '800' },
  stateText: { color: '#747985', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  pressed: { opacity: 0.7 },
});
