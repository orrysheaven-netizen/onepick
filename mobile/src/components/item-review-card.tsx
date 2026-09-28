import { useState } from 'react';
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
 * One review on an item, with its comment thread always open. Current Picks get
 * one positive badge; ended Picks keep the same neutral review presentation so
 * the UI never exposes someone's past-Pick state.
 */
export function ItemReviewCard({ pick, profile, categoryName, itemName, highlighted, onRemoved }: {
  pick: Pick; profile: Profile | null; categoryName: string; itemName: string;
  highlighted: boolean; onRemoved: () => void;
}) {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const isMine = user?.id === pick.userId;
  const isCurrent = pick.isCurrent ?? (pick.status === 'active' || pick.status === 'needs_review');
  const isDeleted = pick.isDeleted ?? false;
  const canManage = !isLoading && (pick.canManage ?? (isMine && isCurrent)) && !isDeleted;
  const [manageMode, setManageMode] = useState<PickManagementMode>('idle');

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
                onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username } })} style={styles.profileLink}>
                <Text numberOfLines={1} style={styles.username}>@{profile.username}</Text>
              </Pressable>
            ) : <Text style={styles.username}>사용자</Text>}
          </View>
        </>}
        {isCurrent ? <Text style={styles.currentBadge}>✓ 이 집 원픽</Text> : null}
        {canManage ? <PickManagementActions onOpen={setManageMode} /> : null}
        <PickShareActions authorUserId={pick.userId} categoryName={categoryName} oneLineReview={pick.oneLineReview}
          pickId={pick.id} itemName={itemName} username={profile?.username ?? '사용자'} />
      </View>
      {isDeleted ? <Text style={styles.history}>삭제된 한줄평입니다. 기존 대화만 남아 있어요.</Text>
        : <Text style={[styles.review, isMine && styles.myReview]}>“{pick.oneLineReview}”</Text>}
      {canManage ? (
        <PickManagement pick={pick} categoryName={categoryName} onRemoved={onRemoved} mode={manageMode} onModeChange={setManageMode} />
      ) : null}
      <PickReplies pickId={pick.id} compact canWrite={!isMine} />
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
  currentBadge: { color: OnePick.accentDeep, fontSize: 11, lineHeight: 15, fontWeight: '800' },
  history: { color: OnePick.muted, fontSize: 12, lineHeight: 16 },
});
