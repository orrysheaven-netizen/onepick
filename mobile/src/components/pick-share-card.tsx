import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReportAction } from '@/components/report-action';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useMyProfile } from '@/hooks/useMyProfile';
import { createPickShareUrl } from '@/lib/share/shareLinks';
import { sharePick } from '@/lib/share/sharePick';

interface PickShareCardProps {
  pickId: string;
  username: string;
  categoryName: string;
  productName: string;
  oneLineReview: string;
}

export function PickShareCard(props: PickShareCardProps) {
  const { user } = useAuthSession();
  const myProfile = useMyProfile(user?.id);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const shareUrl = createPickShareUrl(props.pickId);
  const canReport = Boolean(user && myProfile.data && myProfile.data.profile.username !== props.username);

  const handleShare = async () => {
    if (isSharing) return;

    setIsSharing(true);
    setShareError(false);

    try {
      await sharePick(props);
    } catch {
      setShareError(true);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>SHARE THIS PICK</Text>
      <Text style={styles.title}>이 원픽을 공유해보세요</Text>
      <Text style={styles.description}>
        받은 사람이 OnePick을 설치한 상태라면 이 Pick 상세 화면으로 바로 들어옵니다.
      </Text>
      <Text numberOfLines={1} style={styles.link}>{shareUrl}</Text>

      {shareError ? <Text style={styles.error}>공유 창을 열지 못했어요. 다시 시도해주세요.</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={isSharing}
        onPress={() => void handleShare()}
        style={({ pressed }) => [styles.button, isSharing && styles.buttonDisabled, pressed && styles.pressed]}>
        {isSharing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Pick 공유하기</Text>}
      </Pressable>

      {canReport && user ? (
        <View style={styles.safetyRow}>
          <Text style={styles.safetyText}>문제가 있는 원픽인가요?</Text>
          <ReportAction reporterUserId={user.id} targetType="pick" targetId={props.pickId} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#E3DCD5', borderRadius: 20, padding: 18, marginTop: 14 },
  eyebrow: { color: '#D96D4B', fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 6 },
  description: { color: '#8E8A85', fontSize: 12, lineHeight: 18, marginTop: 7 },
  link: { color: '#AAA39C', fontSize: 10, marginTop: 12 },
  error: { color: '#A9482D', fontSize: 11, lineHeight: 17, marginTop: 10 },
  button: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  safetyRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E3DCD5', marginTop: 14, paddingTop: 14, gap: 8 },
  safetyText: { color: '#8E8A85', fontSize: 10 },
  pressed: { opacity: 0.72 },
});
