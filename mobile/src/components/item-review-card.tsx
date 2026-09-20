import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PickManagement } from '@/components/pick-management';
import { PickReplies } from '@/components/pick-replies';
import { PickShareCard } from '@/components/pick-share-card';
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
        <View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.author}>
          {isMine ? <Text style={styles.badge}>{isCurrent ? '내 원픽' : '내 이전 원픽'}</Text> : null}
          {profile ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`@${profile.username} 공개 프로필 보기`}
              onPress={() => router.push({ pathname: '/u/[username]', params: { username: profile.username } })} style={styles.profileLink}>
              <Text style={styles.username}>@{profile.username} ›</Text>
            </Pressable>
          ) : <Text style={styles.username}>사용자</Text>}
        </View>
        {!isCurrent ? <Text style={styles.history}>이전 원픽</Text> : null}
      </View>
      <Text style={[styles.review, isMine && styles.myReview]}>“{pick.oneLineReview}”</Text>
      {!isCurrent ? <Text style={styles.history}>현재 선택이 종료된 한줄평입니다. 기존 답글은 계속 볼 수 있어요.</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: repliesOpen }}
          onPress={() => setRepliesOpen((open) => !open)} style={styles.action}>
          <Text style={styles.actionText}>{repliesOpen ? '답글 접기' : '답글 보기 · 쓰기'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: sharingOpen }}
          onPress={() => setSharingOpen((open) => !open)} style={styles.action}>
          <Text style={styles.secondary}>{sharingOpen ? '공유 메뉴 접기' : isMine ? '공유' : '공유 · 신고'}</Text>
        </Pressable>
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
  card: { borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 20, padding: 18, marginBottom: 12 },
  mine: { backgroundColor: OnePick.accentSoft, borderColor: OnePick.accentSoft },
  highlight: { borderColor: OnePick.accent, borderWidth: 2, backgroundColor: OnePick.accentSoft },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: OnePick.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: OnePick.onAccent, fontSize: 16, fontWeight: '800' },
  author: { flex: 1 },
  badge: { color: OnePick.accent, fontSize: 12, fontWeight: '800' },
  username: { color: OnePick.text, fontSize: 13, fontWeight: '700' },
  profileLink: { minHeight: 44, justifyContent: 'center' },
  review: { color: OnePick.muted, fontSize: 16, lineHeight: 25, marginVertical: 12 },
  myReview: { fontWeight: '700' },
  history: { color: OnePick.muted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  action: { minHeight: 44, justifyContent: 'center' },
  actionText: { color: OnePick.accent, fontSize: 13, fontWeight: '700' },
  secondary: { color: OnePick.muted, fontSize: 12 },
});

