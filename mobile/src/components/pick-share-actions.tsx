import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ReportAction } from '@/components/report-action';
import { Icon } from '@/components/ui';
import { touchSlop } from '@/components/ui/touch';
import { useAuthSession } from '@/hooks/useAuthSession';
import { sharePick } from '@/lib/share/sharePick';
import { isSeedProfileId } from '@/lib/seedProfiles';
import { observabilityService } from '@/services';
import { OnePick } from '@/constants/onepick';

interface PickShareActionsProps {
  pickId: string;
  authorUserId: string;
  username: string;
  categoryName: string;
  itemName: string;
  oneLineReview: string;
}

/** A review card's corner actions: a share icon, and a "⋯" menu holding 신고 for other people's Picks. */
export function PickShareActions(props: PickShareActionsProps) {
  const { user } = useAuthSession();
  const [isSharing, setIsSharing] = useState(false);
  const [notice, setNotice] = useState<'copied' | 'error' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const canReport = Boolean(user && user.id !== props.authorUserId && !isSeedProfileId(props.authorUserId));

  const handleShare = async () => {
    if (isSharing) return;
    setIsSharing(true);
    setNotice(null);
    void observabilityService.captureProductEvent({
      eventName: 'pick_share_clicked',
      pickId: props.pickId,
      source: 'link',
      path: '/item/[itemId]',
    });
    try {
      if (await sharePick(props) === 'copied') setNotice('copied');
    } catch {
      setNotice('error');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="이 원픽 공유" disabled={isSharing}
          onPress={() => void handleShare()} hitSlop={ICON_SLOP} style={({ pressed }) => [styles.icon, (pressed || isSharing) && styles.pressed]}>
          <Icon name="share" color={OnePick.textSecondary} />
        </Pressable>
        {canReport ? <Pressable accessibilityRole="button" accessibilityLabel={menuOpen ? '더보기 닫기' : '더보기'}
          onPress={() => setMenuOpen((open) => !open)} hitSlop={ICON_SLOP} style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
          <Icon name="more" color={OnePick.textSecondary} />
        </Pressable> : null}
      </View>
      {notice ? <Text accessibilityLiveRegion="polite" style={notice === 'error' ? styles.error : styles.notice}>
        {notice === 'copied' ? '링크를 복사했어요.' : '공유하지 못했어요. 다시 시도해주세요.'}
      </Text> : null}
      {menuOpen && canReport && user ? <View style={styles.menu}>
        <ReportAction reporterUserId={user.id} targetType="pick" targetId={props.pickId} />
      </View> : null}
    </View>
  );
}

// 36px visual buttons keep their layout; hitSlop lifts the touch area to the 44px minimum.
const ICON_SLOP = touchSlop(36, 36);

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end' },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  notice: { color: OnePick.success, fontSize: 11, lineHeight: 15 },
  error: { color: OnePick.danger, fontSize: 11, lineHeight: 15 },
  menu: { marginTop: 4 },
  pressed: { opacity: 0.55 },
});
