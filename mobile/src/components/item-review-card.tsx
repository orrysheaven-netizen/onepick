import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CurrentPickFlag } from '@/components/current-pick-flag';
import { PickManagement, PickManagementActions, type PickManagementMode } from '@/components/pick-management';
import { PickShareActions } from '@/components/pick-share-actions';
import { Avatar } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { Pick } from '@/types/domain/pick';
import type { Profile } from '@/types/domain/profile';
import { OnePick } from '@/constants/onepick';


/**
 * One review row on an item. The list stays compact: review body and comment
 * count open the dedicated conversation route instead of expanding replies here.
 */
export function ItemReviewCard({ pick, profile, categoryName, itemName, itemId, highlighted, onRemoved }: {
  pick: Pick; profile: Profile | null; categoryName: string; itemName: string; itemId: string;
  highlighted: boolean; onRemoved: () => void;
}) {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const isMine = user?.id === pick.userId;
  const isCurrent = pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review');
  const isDeleted = pick.isDeleted ?? false;
  const canManage = !isLoading && (pick.canManage ?? (isMine && isCurrent)) && !isDeleted;
  const commentCount = pick.commentCount ?? 0;
  const [manageMode, setManageMode] = useState<PickManagementMode>('idle');
  const openConversation = () => router.push({ pathname: '/pick/[pickId]', params: { pickId: pick.id, itemId } });

  return (
    <View style={[styles.card, isMine && isCurrent && styles.mine, highlighted && styles.highlight]}>
      <View style={styles.header}>
        {isMine ? (
          <Text style={[styles.author, styles.mineLabel]}>내 한줄평</Text>
        ) : <>
          <Avatar name={profile?.username ?? '?'} size={24} imageUrl={profile?.profileImageUrl} />
          <View style={styles.author}>
            {profile ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`@${profile.username} 공개 프로필 보기`}
                onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username, returnTo: `/item/${itemId}` } })} style={styles.profileLink}>
                <Text numberOfLines={1} style={styles.username}>@{profile.username}</Text>
              </Pressable>
            ) : <Text style={styles.username}>사용자</Text>}
          </View>
        </>}
        {isCurrent ? <CurrentPickFlag mine={isMine} /> : null}
        {canManage ? <PickManagementActions onOpen={setManageMode} /> : null}
        <PickShareActions authorUserId={pick.userId} categoryName={categoryName} oneLineReview={pick.oneLineReview}
          pickId={pick.id} itemName={itemName} username={profile?.username ?? '사용자'} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={itemName + ' 한줄평 대화 보기'} onPress={openConversation}
        style={({ pressed }) => pressed && styles.pressed}>
        {isDeleted ? <Text style={styles.history}>삭제된 한줄평이에요. 기존 대화만 남아 있어요.</Text>
          : <Text style={[styles.review, isMine && styles.myReview]}>“{pick.oneLineReview}”</Text>}
      </Pressable>
      {canManage ? (
        <PickManagement pick={pick} categoryName={categoryName} onRemoved={onRemoved} mode={manageMode} onModeChange={setManageMode} />
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel={itemName + ' 댓글 ' + commentCount + '개 보기'} onPress={openConversation}
        style={({ pressed }) => [styles.commentLink, pressed && styles.pressed]}>
        <Text style={styles.commentLinkText}>{'댓글 ' + commentCount}</Text>
      </Pressable>
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
