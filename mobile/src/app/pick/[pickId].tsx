import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthSession } from '@/hooks/useAuthSession';
import { usePickDetail } from '@/hooks/usePickDetail';

// Preserve old shared links and login return paths without a second detail screen.
export default function PickDetailScreen() {
  const { pickId } = useLocalSearchParams<{ pickId?: string }>();
  const { user } = useAuthSession();
  const router = useRouter();
  const query = usePickDetail(pickId, user?.id);
  if (!query.isPending && !query.isError && query.data) {
    return <Redirect href={{ pathname: '/item/[itemId]', params: { itemId: query.data.pick.itemId, pickId: query.data.pick.id } }} />;
  }
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.content}>
        {query.isPending ? <><ActivityIndicator /><Text>원픽을 불러오고 있어요</Text></> : (
          <>
            <Text>원픽을 볼 수 없어요</Text>
            <Text>삭제되었거나 볼 수 없는 기록일 수 있어요.</Text>
            <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.button}><Text>다시 불러오기</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.button}><Text>홈으로</Text></Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F6F8' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 18 },
});
