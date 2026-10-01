import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getItemLinkSuggestions, reviewItemLinkSuggestion } from '@/lib/admin-api';
import type { AdminItemLinkSuggestion } from '@/lib/admin-api';
import { OnePick } from '@/constants/onepick';

function reviewErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : '';
  if (message.includes('LINK_ITEM_NOT_PLACE')) return '아직 매장에 연결되지 않은 요청입니다. 검수 대기에서 승인하거나 맛집 채널 연결에서 매장을 먼저 연결해 주세요.';
  if (message.includes('LINK_SUGGESTION_NOT_PENDING')) return '이미 처리된 제안입니다. 목록을 새로고침해 주세요.';
  return message || '처리하지 못했습니다.';
}

export function LinkSuggestionsPanel() {
  const [rows, setRows] = useState<AdminItemLinkSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try { setRows(await getItemLinkSuggestions()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '제안을 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const review = async (row: AdminItemLinkSuggestion, approve: boolean) => {
    if (workingId) return;
    setWorkingId(row.suggestion_id);
    setError('');
    setMessage('');
    try {
      await reviewItemLinkSuggestion(row.suggestion_id, approve);
      setMessage(approve ? `${row.place_name ?? row.item_name} 지도 링크를 승인했습니다.` : '제안을 반려했습니다.');
      await load();
    } catch (caught) { setError(reviewErrorMessage(caught)); }
    finally { setWorkingId(null); }
  };

  return <View style={styles.wrap}>
    <View style={styles.headerRow}>
      <Text style={adminStyles.sectionTitle}>대기 중인 제안 {loading ? '' : `${rows.length}건`}</Text>
      <Pressable accessibilityRole="button" onPress={() => void load()} style={adminStyles.secondaryButton}>
        <Text style={adminStyles.secondaryButtonText}>새로고침</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text> : null}
    {message ? <Text style={adminStyles.success}>{message}</Text> : null}
    {loading ? <ActivityIndicator color={OnePick.accent} /> : null}
    {!loading && rows.length === 0 ? <Text style={adminStyles.muted}>처리할 지도 링크 제안이 없습니다.</Text> : null}
    {rows.map((row) => <View key={row.suggestion_id} style={adminStyles.card}>
      <Text style={styles.title}>{row.place_name ? `${row.place_name}${row.place_branch_name ? ` ${row.place_branch_name}` : ''}` : row.item_name} · {row.category_name}</Text>
      <Text style={adminStyles.muted}>{row.place_road_address || (row.item_status === 'pending' ? '검수 대기 중인 새 매장 요청' : '매장 미연결 항목')}</Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(row.url)}>
        <Text style={styles.link}>{row.url}</Text>
      </Pressable>
      <Text style={adminStyles.muted}>현재 링크: {row.current_map_url ?? '없음'} · 제안: @{row.username ?? '알 수 없음'} · {new Date(row.created_at).toLocaleString('ko-KR')}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={Boolean(workingId) || !row.place_id} onPress={() => void review(row, true)}
          style={[adminStyles.primaryButton, (!row.place_id || workingId) && styles.disabled]}>
          <Text style={adminStyles.primaryButtonText}>{workingId === row.suggestion_id ? '처리 중' : '승인'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={Boolean(workingId)} onPress={() => void review(row, false)} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>반려</Text>
        </Pressable>
      </View>
      {!row.place_id ? <Text style={adminStyles.muted}>매장에 연결된 뒤 승인할 수 있습니다.</Text> : null}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: OnePick.text, fontSize: 15, fontWeight: '700' },
  link: { color: OnePick.accent, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  disabled: { opacity: 0.5 },
});
