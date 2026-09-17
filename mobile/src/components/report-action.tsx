import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppError } from '@/errors/appError';
import { useSafetyActions } from '@/hooks/useSafety';
import type { ReportReason, ReportTargetType } from '@/types/domain/safety';

const REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: '스팸' },
  { value: 'harassment', label: '괴롭힘' },
  { value: 'inappropriate', label: '부적절한 콘텐츠' },
  { value: 'misleading', label: '잘못된 정보' },
  { value: 'other', label: '기타' },
];

function errorText(error: unknown) {
  if (error instanceof AppError) {
    if (error.code === 'REPORT_DUPLICATE') return '이미 확인 중인 신고가 있습니다.';
    if (error.code === 'REPORT_SELF') return '내 콘텐츠는 신고할 수 없습니다.';
    if (error.code === 'REPORT_TARGET_NOT_FOUND') return '신고할 콘텐츠를 찾을 수 없습니다.';
  }
  return '신고를 접수하지 못했습니다. 다시 시도해주세요.';
}

export function ReportAction({
  reporterUserId,
  targetType,
  targetId,
}: {
  reporterUserId?: string;
  targetType: ReportTargetType;
  targetId: string;
}) {
  const { submitReport } = useSafetyActions();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (!reporterUserId) return null;

  const submit = async (reason: ReportReason) => {
    try {
      await submitReport.mutateAsync({
        reporterUserId,
        targetType,
        targetId,
        reason,
      });
      setDone(true);
      setOpen(false);
    } catch {
      // Mutation state renders the failure.
    }
  };

  if (done) return <Text style={styles.done}>신고가 접수됐습니다.</Text>;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setOpen((value) => !value);
          submitReport.reset();
        }}
        style={({ pressed }) => [styles.reportButton, pressed && styles.pressed]}>
        <Text style={styles.reportButtonText}>{open ? '신고 취소' : '신고'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.panel}>
          <Text style={styles.title}>신고 사유를 선택해주세요</Text>
          <View style={styles.reasons}>
            {REASONS.map((reason) => (
              <Pressable
                key={reason.value}
                disabled={submitReport.isPending}
                onPress={() => void submit(reason.value)}
                style={({ pressed }) => [styles.reasonButton, pressed && styles.pressed]}>
                {submitReport.isPending ? null : <Text style={styles.reasonText}>{reason.label}</Text>}
              </Pressable>
            ))}
          </View>
          {submitReport.isPending ? <ActivityIndicator style={styles.loading} /> : null}
          {submitReport.isError ? <Text style={styles.error}>{errorText(submitReport.error)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'flex-start' },
  reportButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#DDD5CD' },
  reportButtonText: { color: '#747985', fontSize: 12, fontWeight: '800' },
  panel: { backgroundColor: '#F5F6F8', borderRadius: 14, padding: 12, marginTop: 8, maxWidth: 360 },
  title: { color: '#5F5A54', fontSize: 12, fontWeight: '800' },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  reasonButton: { minHeight: 38, justifyContent: 'center', borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  reasonText: { color: '#625A53', fontSize: 12, fontWeight: '800' },
  loading: { marginTop: 10 },
  done: { color: '#6A7665', fontSize: 12, fontWeight: '700' },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 16, marginTop: 9 },
  pressed: { opacity: 0.65 },
});
