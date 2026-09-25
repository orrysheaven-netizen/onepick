import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PickManagement } from '@/components/pick-management';
import { PickReplies } from '@/components/pick-replies';
import { PickShareCard } from '@/components/pick-share-card';
import { Avatar, Button } from '@/components/ui';
import { useAuthSession } from '@/hooks/useAuthSession';
import type { Pick } from '@/types/domain/pick';
import type { Profile } from '@/types/domain/profile';
import { OnePick } from '@/constants/onepick';

export function ItemReviewCard({ pick, profile, categoryName, itemName, focused, highlighted, onRemoved }: {
  pick: Pick; profile: Profile | null; categoryName: string; itemName: string;
  focused: boolean; highlighted: boolean; onRemoved: () => void;
}) {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const isMine = user?.id === pick.userId;
  const isCurrent = pick.status === 'active' || pick.status === 'needs_review';
  const [repliesOpen, setRepliesOpen] = useState(focused);
  const [sharingOpen, setSharingOpen] = useState(false);
  useEffect(() => { if (focused) setRepliesOpen(true); }, [focused]);

  return (
    <View style={[styles.card, isMine && isCurrent && styles.mine, highlighted && styles.highlight]}>
      <View style={styles.header}>
        <Avatar name={profile?.username ?? '?'} size={32} />
        <View style={styles.author}>
          {profile ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`@${profile.username} 공개 프로필 보기`}
              onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username } })} style={styles.profileLink}>
              <Text numberOfLines={1} style={styles.username}>@{profile.username} ›</Text>
            </Pressable>
          ) : <Text style={styles.username}>사용자</Text>}
        </View>
        {isMine ? <View style={styles.badge}><Text style={styles.badgeText}>{!isCurrent ? '내 이전 원픽' : pick.position > 1 ? `내 원픽 ${pick.position}` : '내 원픽'}</Text></View> : null}
        {!isCurrent && !isMine ? <Text style={styles.history}>이전 원픽</Text> : null}
      </View>
      <Text style={[styles.review, isMine && styles.myReview]}>“{pick.oneLineReview}”</Text>
      {!isCurrent ? <Text style={styles.history}>현재 선택이 종료된 한줄평입니다. 기존 댓글은 계속 볼 수 있어요.</Text> : null}
      <View style={styles.actions}>
        <Button variant="ghost" size="sm" style={styles.action} onPress={() => setRepliesOpen((open) => !open)}
          label={repliesOpen ? '댓글 접기' : pick.status === 'active' ? '댓글 쓰기' : '댓글 보기'} />
        <Button variant="ghost" size="sm" style={styles.action} onPress={() => setSharingOpen((open) => !open)}
          label={sharingOpen ? '공유 메뉴 접기' : isMine ? '공유' : '공유 · 신고'} />
      </View>
      {!isLoading && isMine && isCurrent ? (
        <PickManagement pick={pick} categoryName={categoryName} onRemoved={onRemoved} />
      ) : null}
      {/* Keep the mounted thread while collapsed so an unfinished reply is preserved. */}
      <ReplyThread pickId={pick.id} open={repliesOpen} />
      {sharingOpen ? <PickShareCard authorUserId={pick.userId} categoryName={categoryName}
        oneLineReview={pick.oneLineReview} pickId={pick.id} itemName={itemName} username={profile?.username ?? '사용자'} /> : null}
    </View>
  );
}

function ReplyThread({ pickId, open }: { pickId: string; open: boolean }) {
  const [visited, setVisited] = useState(open);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  return open || visited ? <View style={!open ? { display: 'none' } : undefined}><PickReplies pickId={pickId} /></View> : null;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 16, marginBottom: 12 },
  mine: { backgroundColor: OnePick.accentSoft, borderColor: OnePick.accentSoft },
  highlight: { borderColor: OnePick.accent, borderWidth: 2, backgroundColor: OnePick.accentSoft },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  author: { flex: 1, minWidth: 0 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: OnePick.surface },
  badgeText: { color: OnePick.accentDeep, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  username: { color: OnePick.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  profileLink: { minHeight: 44, justifyContent: 'center' },
  review: { color: OnePick.text, fontSize: 15, lineHeight: 22, marginVertical: 12 },
  myReview: { fontWeight: '600' },
  history: { color: OnePick.muted, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginLeft: -8 },
  action: { alignSelf: 'auto' },
});

