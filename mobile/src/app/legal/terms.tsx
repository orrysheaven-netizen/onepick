import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

export default function TermsScreen() {
  const router = useRouter();
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backButton}><Icon name="back" /></Pressable>
      <Text style={styles.kicker}>TERMS</Text>
      <Text style={styles.title}>OnePick YouTube API 이용조건</Text>
      <Text style={styles.note}>시행일 · 2026-09-19</Text>

      <View style={styles.card}>
        <Text style={styles.heading}>원픽 서비스</Text>
        <Text style={styles.body}>OnePick은 사용자가 카테고리별로 하나의 취향을 선택하고 자신의 이유를 남기는 서비스입니다. 외부 카탈로그 정보는 선택 대상을 찾기 위한 보조 정보입니다.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>YouTube 기능</Text>
        <Text style={styles.body}>OnePick의 YouTube 채널 검색 기능을 사용하는 경우 사용자는 YouTube 이용약관에 동의하고 그 적용을 받습니다. YouTube 채널 검색 결과는 원픽 대상을 찾기 위한 보조 정보이며, OnePick은 YouTube를 복제하거나 영상 콘텐츠를 저장·오프라인 제공하지 않습니다.</Text>
        <ExternalLink href="https://www.youtube.com/t/terms" style={styles.link}>YouTube 이용약관 보기</ExternalLink>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>외부 정보 변경</Text>
        <Text style={styles.body}>외부 공급처의 데이터가 변경되거나 삭제되면 OnePick에 표시되는 메타데이터도 갱신·제거될 수 있습니다. 사용자가 남긴 원픽 이유와 사회적 기록은 가능한 범위에서 별도로 보존합니다.</Text>
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
