import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppError } from '@/errors/appError';
import { useAuthSession } from '@/hooks/useAuthSession';
import { useBlockedUsers, useSafetyActions } from '@/hooks/useSafety';
import { useDeleteAccount } from '@/hooks/useDeleteAccount';

function deletionError(error: unknown) {
  if (error instanceof AppError && error.code === 'ACCOUNT_DELETE_FAILED') {
    return '계정을 삭제하지 못했습니다. 다시 시도해주세요.';
  }
  return '계정을 삭제하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.';
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, isLoading } = useAuthSession();
  const blocked = useBlockedUsers(user?.id);
  const safety = useSafetyActions();
  const deleteAccount = useDeleteAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteAccount = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    try {
      await deleteAccount.mutateAsync();
      router.replace('/');
    } catch {
      // Mutation state renders the failure. Keep confirmation visible for retry.
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.eyebrow}>SETTINGS</Text>
        <Text style={styles.title}>계정 설정</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>정책 및 개인정보 안내</Text>
          <Text style={styles.body}>YouTube API 사용 안내와 이용조건은 언제든 확인할 수 있습니다.</Text>
          <View style={styles.actionRow}>
            <Pressable onPress={() => router.push('/legal/privacy')} style={styles.smallButton}><Text style={styles.smallButtonText}>개인정보·YouTube API 안내</Text></Pressable>
            <Pressable onPress={() => router.push('/legal/terms')} style={styles.smallButton}><Text style={styles.smallButtonText}>YouTube API 이용조건</Text></Pressable>
          </View>
        </View>

        {isLoading ? <ActivityIndicator style={styles.loading} /> : null}

        {!isLoading && !user ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>로그인이 필요해요</Text>
            <Text style={styles.body}>차단 목록과 계정 설정은 로그인 후 관리할 수 있습니다.</Text>
            <Pressable onPress={() => router.push('/auth/login')} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>로그인</Text>
            </Pressable>
          </View>
        ) : null}

        {user ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>차단한 사용자</Text>
              <Text style={styles.body}>차단하면 서로의 프로필, 원픽, 댓글이 로그인 상태에서 보이지 않습니다.</Text>
              {blocked.isPending ? <ActivityIndicator style={styles.inlineLoading} /> : null}
              {blocked.isError ? (
                <Pressable onPress={() => void blocked.refetch()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>차단 목록 다시 불러오기</Text>
                </Pressable>
              ) : null}
              {blocked.data?.length === 0 ? <Text style={styles.empty}>차단한 사용자가 없습니다.</Text> : null}
              {blocked.data?.map((item) => (
                <View key={item.blockedUserId} style={styles.blockRow}>
                  <Text style={styles.blockName}>@{item.blockedUsername}</Text>
                  <Pressable
                    disabled={safety.unblockUser.isPending}
                    onPress={() => void safety.unblockUser.mutateAsync({
                      blockerUserId: user.id,
                      blockedUserId: item.blockedUserId,
                    })}
                    style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                    <Text style={styles.smallButtonText}>차단 해제</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            <View style={[styles.card, styles.dangerCard]}>
              <Text style={styles.dangerTitle}>계정 삭제</Text>
              <Text style={styles.body}>
                내 프로필, 원픽 기록, 댓글과 차단 정보가 삭제됩니다. 이미 승인된 정식 제품 마스터는 서비스 데이터로 유지될 수 있지만 내 계정과의 연결은 제거됩니다.
              </Text>
              {confirmDelete ? (
                <Text style={styles.confirmText}>계정 삭제는 되돌릴 수 없습니다. 한 번 더 누르면 삭제합니다.</Text>
              ) : null}
              {deleteAccount.isError ? <Text style={styles.error}>{deletionError(deleteAccount.error)}</Text> : null}
              <View style={styles.actionRow}>
                <Pressable
                  disabled={deleteAccount.isPending}
                  onPress={() => void handleDeleteAccount()}
                  style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                  {deleteAccount.isPending ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.deleteButtonText}>{confirmDelete ? '계정 삭제 확인' : '계정 삭제'}</Text>
                  )}
                </Pressable>
                {confirmDelete && !deleteAccount.isPending ? (
                  <Pressable onPress={() => setConfirmDelete(false)} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>취소</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 48 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginLeft: -10 },
  backText: { color: '#202124', fontSize: 36, lineHeight: 38, fontWeight: '300' },
  eyebrow: { color: '#4945ED', fontSize: 12, fontWeight: '800', letterSpacing: 2.4, marginTop: 8 },
  title: { color: '#202124', fontSize: 28, fontWeight: '900', marginTop: 8, marginBottom: 22 },
  loading: { marginTop: 24 },
  inlineLoading: { marginTop: 14 },
  card: { borderWidth: 1, borderColor: '#E3E5EA', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 14 },
  dangerCard: { borderWidth: 1, borderColor: '#E8C6BB' },
  cardTitle: { color: '#202124', fontSize: 17, fontWeight: '800' },
  dangerTitle: { color: '#9D3E2C', fontSize: 17, fontWeight: '800' },
  body: { color: '#736D67', fontSize: 12, lineHeight: 19, marginTop: 8 },
  empty: { color: '#9B958F', fontSize: 12, marginTop: 16 },
  blockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E3E5EA' },
  blockName: { flex: 1, color: '#202124', fontSize: 13, fontWeight: '800' },
  smallButton: { borderRadius: 12, borderWidth: 1, borderColor: '#DDD5CD', paddingHorizontal: 12, paddingVertical: 9 },
  smallButtonText: { color: '#625A53', fontSize: 12, fontWeight: '800' },
  primaryButton: { alignItems: 'center', backgroundColor: '#202124', borderRadius: 14, paddingVertical: 13, marginTop: 16 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  deleteButton: { minHeight: 44, minWidth: 130, alignItems: 'center', justifyContent: 'center', backgroundColor: '#A9482D', borderRadius: 14, paddingHorizontal: 16 },
  deleteButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  secondaryButton: { alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, borderColor: '#D7CEC6', paddingHorizontal: 14, paddingVertical: 11, marginTop: 12 },
  secondaryButtonText: { color: '#625A53', fontSize: 12, fontWeight: '800' },
  confirmText: { color: '#9D3E2C', fontSize: 12, lineHeight: 19, fontWeight: '700', marginTop: 12 },
  error: { color: '#A9482D', fontSize: 12, lineHeight: 17, marginTop: 10 },
  pressed: { opacity: 0.7 },
});
