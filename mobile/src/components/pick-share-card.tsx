import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReportAction } from '@/components/report-action';
import { useAuthSession } from '@/hooks/useAuthSession';
import { createPickShareUrl } from '@/lib/share/shareLinks';
import { sharePick } from '@/lib/share/sharePick';

interface PickShareCardProps {
  pickId: string;
  authorUserId: string;
  username: string;
  categoryName: string;
  productName: string;
  oneLineReview: string;
}

export function PickShareCard(props: PickShareCardProps) {
  const { user } = useAuthSession();
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const shareUrl = createPickShareUrl(props.pickId);
  const canReport = Boolean(user && user.id !== props.authorUserId);

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
        이 원픽과 선택한 이유를 링크로 함께 전해보세요.
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
  card: { borderWidth: 1, borderColor: '#E3E5EA', borderRadius: 20, padding: 18, marginTop: 14 },
  eyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: '#202124', fontSize: 16, fontWeight: '800', marginTop: 6 },
  description: { color: '#747985', fontSize: 12, lineHeight: 18, marginTop: 7 },
  link: { color: '#89909C', fontSize: 12, marginTop: 12 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 17, marginTop: 10 },
  button: { minHeight: 46, borderRadius: 15, backgroundColor: '#202124', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  safetyRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E3E5EA', marginTop: 14, paddingTop: 14, gap: 8 },
  safetyText: { color: '#747985', fontSize: 12 },
  pressed: { opacity: 0.72 },
});
