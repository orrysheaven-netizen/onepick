import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getItemPhotoCandidates, reviewItemPhotoCandidate } from '@/lib/admin-api';
import type { AdminItemPhotoCandidate } from '@/lib/admin-api';
import { itemPhotoUrl } from '@/lib/admin/itemPhoto';
import { OnePick } from '@/constants/onepick';

function reviewErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : '';
  if (message.includes('PHOTO_CANDIDATE_NOT_PENDING')) return '이미 처리된 사진입니다. 목록을 새로고침해 주세요.';
  if (message.includes('ITEM_PHOTO_EXISTS')) return '이 상품에는 이미 대표사진이 있습니다. 교체는 상품 관리에서 해 주세요.';
  if (message.includes('ITEM_NOT_ELIGIBLE')) return '공개 중인 상품이 아니어서 승인할 수 없습니다.';
  if (message.includes('PHOTO_INVALID')) return '저장된 사진 파일을 확인할 수 없습니다. 반려해 주세요.';
  return message || '처리하지 못했습니다.';
}

// L4: the first photo of a published product stays with its uploader until approved here.
export function PhotoCandidatesPanel() {
  const [rows, setRows] = useState<AdminItemPhotoCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try { setRows(await getItemPhotoCandidates()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '사진을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const review = async (row: AdminItemPhotoCandidate, approve: boolean) => {
    if (workingId) return;
    setWorkingId(row.candidate_id);
    setError('');
    setMessage('');
    try {
      await reviewItemPhotoCandidate(row.candidate_id, approve);
      setMessage(approve
        ? `${row.item_name} 대표사진을 승인했습니다. 이 사진을 기다리던 원픽도 공개됩니다.`
        : `${row.item_name} 사진을 반려했습니다. 원픽은 유지되고 등록자가 다시 올릴 수 있습니다.`);
      await load();
    } catch (caught) { setError(reviewErrorMessage(caught)); }
    finally { setWorkingId(null); }
  };

  return <View style={styles.wrap}>
    <View style={styles.headerRow}>
      <Text style={adminStyles.sectionTitle}>검수 대기 사진 {loading ? '' : `${rows.length}건`}</Text>
      <Pressable accessibilityRole="button" onPress={() => void load()} style={adminStyles.secondaryButton}>
        <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text> : null}
    {message ? <Text style={adminStyles.success}>{message}</Text> : null}
    {loading ? <ActivityIndicator color={OnePick.accent} /> : null}
    {!loading && rows.length === 0 ? <Text style={adminStyles.muted}>검수할 사진이 없습니다.</Text> : null}
    {rows.map((row) => {
      const preview = itemPhotoUrl(row.thumbnail_path) ?? undefined;
      const original = itemPhotoUrl(row.image_path);
      const busy = workingId === row.candidate_id;
      return <View key={row.candidate_id} style={[adminStyles.card, styles.card]}>
        <Image source={{ uri: preview }} style={styles.photo} resizeMode="contain" accessibilityLabel={`${row.item_name} 검수 대기 사진`} />
        <View style={styles.copy}>
          <Text style={styles.title}>{row.item_name} · {row.category_name}</Text>
          <Text style={adminStyles.muted}>등록: @{row.username ?? '알 수 없음'} · {new Date(row.created_at).toLocaleString('ko-KR')}</Text>
          {original ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(original)}>
            <Text style={styles.link}>원본 보기</Text>
          </Pressable> : null}
          {row.image_source_url ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(row.image_source_url!)}>
            <Text style={styles.link}>출처: {row.image_source_url}</Text>
          </Pressable> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={Boolean(workingId)} onPress={() => void review(row, true)}
              style={[adminStyles.primaryButton, workingId && styles.disabled]}>
              <Text style={adminStyles.primaryButtonText}>{busy ? '처리 중' : '승인'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={Boolean(workingId)} onPress={() => void review(row, false)}
              style={[adminStyles.secondaryButton, workingId && styles.disabled]}>
              <Text style={adminStyles.secondaryButtonText}>반려</Text>
            </Pressable>
          </View>
        </View>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { flexDirection: 'row', gap: 14 },
  photo: { width: 120, height: 120, borderRadius: 8, backgroundColor: OnePick.surface },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: OnePick.text, fontSize: 15, fontWeight: '700' },
  link: { color: OnePick.accent, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  disabled: { opacity: 0.5 },
});
