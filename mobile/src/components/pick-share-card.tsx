import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReportAction } from '@/components/report-action';
import { useAuthSession } from '@/hooks/useAuthSession';
import { createPickShareUrl } from '@/lib/share/shareLinks';
import { sharePick } from '@/lib/share/sharePick';
import { sharePickCardImage } from '@/lib/share/sharePickCard';
import { isDemoUsername } from '@/lib/demoProfile';
import { observabilityService } from '@/services';

interface PickShareCardProps {
  pickId: string;
  authorUserId: string;
  username: string;
  categoryName: string;
  itemName: string;
  oneLineReview: string;
}

export function PickShareCard(props: PickShareCardProps) {
  const { user } = useAuthSession();
  const [isSharing, setIsSharing] = useState(false);
  const [isCardSharing, setIsCardSharing] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [cardError, setCardError] = useState(false);
  const [cardSaved, setCardSaved] = useState(false);
  const shareUrl = createPickShareUrl(props.pickId);
  const isDemo = isDemoUsername(props.username);
  const canReport = Boolean(user && user.id !== props.authorUserId && !isDemo);

  const handleShare = async () => {
    if (isSharing || isCardSharing) return;

    setIsSharing(true);
    setShareError(false);
    void observabilityService.captureProductEvent({
      eventName: 'pick_share_clicked',
      pickId: props.pickId,
      source: 'link',
      path: '/pick/[pickId]',
    });

    try {
      await sharePick(props);
    } catch {
      setShareError(true);
    } finally {
      setIsSharing(false);
    }
  };

  const handleCardShare = async () => {
    if (isSharing || isCardSharing) return;

    setIsCardSharing(true);
    setCardError(false);
    setCardSaved(false);
    void observabilityService.captureProductEvent({
      eventName: 'pick_share_clicked',
      pickId: props.pickId,
      source: 'image_card',
      path: '/pick/[pickId]',
    });

    try {
      const result = await sharePickCardImage(props);
      if (result === 'downloaded') setCardSaved(true);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
        setCardError(true);
      }
    } finally {
      setIsCardSharing(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>SHARE THIS PICK</Text>
      <Text style={styles.title}>이 원픽을 공유해보세요</Text>
      <Text style={styles.description}>
        이 원픽과 선택한 이유를 카드나 링크로 전해보세요.
      </Text>

      {Platform.OS === 'web' ? <View style={styles.preview}>
        <View style={styles.previewTop}>
          <Text style={styles.previewBrand}>ONE PICK</Text>
          {isDemo ? <Text style={styles.previewDemo}>DEMO DATA</Text> : null}
        </View>
        <Text style={styles.previewCategory}>{props.categoryName}</Text>
        <Text numberOfLines={2} style={styles.previewItem}>{props.itemName}</Text>
        <View style={styles.previewDivider} />
        <Text style={styles.previewLabel}>WHY THIS ONE</Text>
        <Text numberOfLines={4} style={styles.previewReview}>“{props.oneLineReview}”</Text>
        <Text style={styles.previewUser}>@{props.username}</Text>
      </View> : null}

      {Platform.OS === 'web' ? <Pressable
        accessibilityRole="button"
        disabled={isCardSharing || isSharing}
        onPress={() => void handleCardShare()}
        style={({ pressed }) => [styles.cardButton, (isCardSharing || isSharing) && styles.buttonDisabled, pressed && styles.pressed]}>
        {isCardSharing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>이미지 카드 공유</Text>}
      </Pressable> : null}

      {cardSaved ? <Text style={styles.success}>이미지 카드가 저장됐어요. 원하는 앱에서 첨부해 공유할 수 있어요.</Text> : null}
      {cardError ? <Text style={styles.error}>이미지 카드를 만들지 못했어요. 링크 공유를 이용해주세요.</Text> : null}

      <Text numberOfLines={1} style={styles.link}>{shareUrl}</Text>
      {shareError ? <Text style={styles.error}>공유 창을 열지 못했어요. 다시 시도해주세요.</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={isSharing || isCardSharing}
        onPress={() => void handleShare()}
        style={({ pressed }) => [styles.linkButton, (isSharing || isCardSharing) && styles.buttonDisabled, pressed && styles.pressed]}>
        {isSharing ? <ActivityIndicator color="#202124" /> : <Text style={styles.linkButtonText}>링크 공유</Text>}
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
  preview: { borderRadius: 18, backgroundColor: '#F7F7FF', borderWidth: 1, borderColor: '#DDDDF5', padding: 18, marginTop: 16 },
  previewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  previewBrand: { color: '#4945ED', fontSize: 12, fontWeight: '900', letterSpacing: 1.7 },
  previewDemo: { color: '#8A5A00', backgroundColor: '#FFF3CD', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, fontSize: 9, lineHeight: 12, fontWeight: '900' },
  previewCategory: { color: '#747985', fontSize: 11, fontWeight: '700', marginTop: 14 },
  previewItem: { color: '#202124', fontSize: 24, lineHeight: 31, fontWeight: '900', marginTop: 6 },
  previewDivider: { height: 1, backgroundColor: '#E3E5EA', marginVertical: 16 },
  previewLabel: { color: '#4945ED', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  previewReview: { color: '#3E4350', fontSize: 14, lineHeight: 21, marginTop: 8 },
  previewUser: { color: '#202124', fontSize: 12, fontWeight: '800', marginTop: 16 },
  link: { color: '#89909C', fontSize: 12, marginTop: 12 },
  success: { color: '#3D7A55', fontSize: 12, lineHeight: 17, marginTop: 10 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 17, marginTop: 10 },
  cardButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#4945ED', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  linkButton: { minHeight: 46, borderRadius: 15, borderWidth: 1, borderColor: '#D4D6DD', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  linkButtonText: { color: '#202124', fontSize: 13, fontWeight: '800' },
  safetyRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E3E5EA', marginTop: 14, paddingTop: 14, gap: 8 },
  safetyText: { color: '#747985', fontSize: 12 },
  pressed: { opacity: 0.72 },
});
