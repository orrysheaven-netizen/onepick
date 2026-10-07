import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

export default function PrivacyScreen() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backButton}><Icon name="back" /></Pressable>
      <Text style={styles.kicker}>PRIVACY</Text>
      <Text style={styles.title}>개인정보 및 YouTube API 안내</Text>
      <Text style={styles.note}>시행일 · 2026-09-19</Text>

      <View style={styles.card}>
        <Text style={styles.heading}>YouTube API 사용</Text>
        <Text style={styles.body}>OnePick의 유튜브 채널 검색은 YouTube Data API Services를 사용합니다. 사용자가 입력한 검색어 또는 @handle/채널 주소는 OnePick 서버를 거쳐 YouTube Data API로 전달됩니다. 검색·선택에 필요한 채널 ID, 채널 제목, 채널 썸네일 URL만 사용하며 구독자 수, 조회수, 영상 수 같은 통계는 요청하지 않습니다.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>저장 및 갱신</Text>
        <Text style={styles.body}>사용자가 원픽으로 선택한 채널의 ID·제목·채널 URL·썸네일 URL은 OnePick 항목과 연결되어 저장될 수 있습니다. YouTube API에서 받은 비인가 데이터는 30일보다 짧은 25일 기준으로 재검증하거나 제거합니다. 검색 캐시도 같은 원칙으로 정리하며, YouTube 영상 파일이나 썸네일 파일 자체를 OnePick Storage에 복제하지 않습니다.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>계정 연결</Text>
        <Text style={styles.body}>현재 MVP는 사용자의 YouTube/Google 계정을 OAuth로 연결하지 않으며 YouTube 로그인 자격증명을 수집하지 않습니다.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>관련 정책</Text>
        <ExternalLink href="https://www.youtube.com/t/terms" style={styles.link}>YouTube 이용약관</ExternalLink>
        <ExternalLink href="https://policies.google.com/privacy" style={styles.link}>Google 개인정보처리방침</ExternalLink>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:OnePick.background},
  content:{width:'100%',maxWidth:680,alignSelf:'center',padding:22,paddingBottom:50},
  backButton:{width:44,height:44,justifyContent:'center',marginLeft:-10},
  kicker:{color:OnePick.accent,fontSize:12,fontWeight:'800',letterSpacing:2,marginTop:12},
  title:{fontSize:27,fontWeight:'900',color:OnePick.text,marginTop:8},
  note:{fontSize:12,lineHeight:19,color:OnePick.danger,marginTop:10},
  card:{backgroundColor:OnePick.surface,borderRadius:18,padding:18,marginTop:14,borderWidth:1,borderColor:OnePick.border},
  heading:{fontSize:16,fontWeight:'800',color:OnePick.text},
  body:{fontSize:12,lineHeight:20,color:OnePick.muted,marginTop:8},
  link:{color:OnePick.accent,fontSize:13,fontWeight:'700',marginTop:12},
});
