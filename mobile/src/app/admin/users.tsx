import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { adminStyles } from '@/components/admin/admin-shell';
import { getUsers } from '@/lib/admin-api';
import type { AdminUser } from '@/lib/admin-api';

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await getUsers(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사용자 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <View style={styles.page}>
      <View>
        <Text style={adminStyles.pageTitle}>사용자</Text>
        <Text style={adminStyles.pageDescription}>가입 사용자와 온보딩 상태를 조회합니다. 현재 스키마에는 정지/탈퇴 같은 관리자용 계정 상태 필드가 없어 조회 전용으로 운영합니다.</Text>
      </View>

      <View style={styles.toolbar}>
        <TextInput
          accessibilityLabel="사용자 검색"
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={load}
          placeholder="username 검색"
          style={[adminStyles.input, styles.search]}
        />
        <Pressable onPress={load} style={adminStyles.secondaryButton}>
          <Text style={adminStyles.secondaryButtonText}>검색</Text>
        </Pressable>
      </View>

      {!!error && <Text accessibilityRole="alert" style={adminStyles.error}>{error}</Text>}

      <View style={adminStyles.card}>
        <View style={styles.header}>
          <Text style={adminStyles.sectionTitle}>사용자 · {users.length}</Text>
          {loading && <ActivityIndicator size="small" />}
        </View>
        {!loading && users.length === 0 && <Text style={styles.empty}>조건에 맞는 사용자가 없습니다.</Text>}
        {users.map((user) => (
          <View key={user.id} style={styles.userRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{user.username.slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.userBody}>
              <Text style={styles.username}>@{user.username}</Text>
              <Text selectable style={adminStyles.muted}>{user.id}</Text>
            </View>
            <View style={styles.meta}>
              <Text style={styles.metaValue}>{user.onboarding_completed ? '온보딩 완료' : '온보딩 미완료'}</Text>
              <Text style={adminStyles.muted}>{new Date(user.created_at).toLocaleDateString('ko-KR')} 가입</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20 },
  toolbar: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  search: { flexGrow: 1, flexBasis: 280, maxWidth: 520 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 13, paddingVertical: 24 },
  userRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#F0F1F3' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#4B5563', fontSize: 14, fontWeight: '800' },
  userBody: { flex: 1, minWidth: 0 },
  username: { color: '#111827', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  meta: { alignItems: 'flex-end', gap: 4 },
  metaValue: { color: '#374151', fontSize: 12, fontWeight: '600' },
});
