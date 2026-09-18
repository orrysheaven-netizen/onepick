import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuthSession } from '@/hooks/useAuthSession';
import { supabase } from '@/lib/supabase/client';
import { AdminMfaService } from '@/services/adminMfaService';

const service = new AdminMfaService(supabase);
type Status = Awaited<ReturnType<AdminMfaService['status']>>;
type Enrollment = Awaited<ReturnType<AdminMfaService['enroll']>>;

export default function AdminSecurityScreen() {
  const auth = useAuthSession();
  const router = useRouter();
  if (auth.isLoading) return <ActivityIndicator />;
  if (!auth.user || auth.error) return <View style={styles.page}><Text>관리자 계정으로 로그인한 후 다시 열어주세요.</Text><Pressable onPress={() => router.replace('/auth/login')}><Text style={styles.link}>로그인</Text></Pressable></View>;
  return <SecurityForm key={auth.user.id} userId={auth.user.id} />;
}

function SecurityForm({ userId }: { userId: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const [status, setStatus] = useState<Status | null>(null);
  // Enrollment secrets stay in this screen's memory, never in query caches or storage.
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    let mounted = true;
    active.current = true;
    void service.status(userId).then((next) => {
      if (mounted) { setStatus(next); setFactorId(next.verified[0]?.id ?? ''); }
    }).catch(() => { if (mounted) setError('관리자 권한 또는 연결 상태를 확인하지 못했습니다. 다시 확인해주세요.'); });
    return () => { mounted = false; active.current = false; };
  }, [userId]);

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : '처리하지 못했습니다. 다시 시도해주세요.'); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  async function refresh() {
    const next = await service.status(userId);
    if (active.current) { setStatus(next); setFactorId(next.verified[0]?.id ?? ''); }
  }
  const button = (label: string, action: () => Promise<void>, disabled = false) => <Pressable accessibilityRole="button" disabled={busy || disabled} style={[styles.button, (busy || disabled) && styles.disabled]} onPress={() => void run(action)}><Text style={styles.buttonText}>{label}</Text></Pressable>;

  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.title}>관리자 추가 인증</Text>
    <Text style={styles.text}>인증 앱에 표시되는 번호로 관리자 계정을 한 번 더 확인합니다.</Text>
    <Text style={styles.note}>모든 관리자 화면과 데이터 접근에 추가 인증(AAL2)이 필수로 적용되어 있습니다. 아래 인증을 완료해야 관리자 화면을 사용할 수 있습니다.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {busy ? <ActivityIndicator /> : null}
    {!status ? button('상태 다시 확인', refresh) : !status.emailReady ? <View style={styles.card}>
      <Text style={styles.heading}>먼저 관리자 이메일을 연결해주세요</Text>
      <Text style={styles.text}>카카오 로그인에 이메일이 포함되지 않아 인증 앱 등록에 필요한 정보가 없습니다. 본인이 받을 수 있는 이메일을 연결하고 확인해야 합니다.</Text>
      <TextInput accessibilityLabel="관리자 이메일" placeholder="이메일 주소" value={email} onChangeText={(value) => { setEmail(value); setEmailSent(false); }} editable={!busy} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.emailInput} />
      {button('확인 메일 보내기', async () => {
        const redirectTo = Platform.OS === 'web' ? `${window.location.origin}/auth/callback` : Linking.createURL('auth/callback');
        await service.requestEmail(userId, email, redirectTo);
        if (active.current) setEmailSent(true);
      }, !email.trim() || emailSent)}
      {emailSent ? <Text style={styles.text}>확인 메일을 보냈습니다. 메일의 확인 링크를 누른 뒤 이 화면으로 돌아와 아래 버튼을 눌러주세요. 스팸함도 확인해주세요.</Text> : null}
      {button('메일 확인 완료 · 상태 다시 확인', async () => { await refresh(); })}
    </View> : status.elevated ? <View style={styles.card}>
      <Text style={styles.heading}>추가 인증이 완료됐습니다.</Text>
      <Text style={styles.text}>이번 로그인에서 추가 인증을 확인했습니다.</Text>
      {button('관리자 화면으로', async () => { await client.invalidateQueries({ queryKey: ['admin'] }); router.replace('/admin'); })}
    </View> : <View style={styles.card}>
      {enrollment ? <>
        <Text style={styles.heading}>1. 인증 앱에 OnePick 추가</Text>
        <Text style={styles.text}>휴대폰의 인증 앱에서 계정 추가를 누르고 아래 QR 코드를 스캔해주세요.</Text>
        <Image source={{ uri: enrollment.qr.startsWith('data:') ? enrollment.qr : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qr)}` }} style={styles.qr} cachePolicy="none" accessibilityLabel="인증 앱 등록용 QR 코드" />
        <Text style={styles.text}>직접 입력하려면 계정 이름은 OnePick, 키 유형은 시간 기반으로 선택하세요.</Text>
        <Text selectable style={styles.secret}>{enrollment.secret}</Text>
        <Text style={styles.text}>이 키와 QR 코드는 다른 사람에게 보내지 마세요.</Text>
      </> : status.verified.length ? <>
        <Text style={styles.heading}>인증 앱을 열어주세요</Text>
        {status.verified.map((factor) => <Pressable key={factor.id} disabled={busy} onPress={() => setFactorId(factor.id)}><Text style={styles.link}>{factorId === factor.id ? '● ' : '○ '}{factor.friendly_name ?? '등록된 인증 앱'}</Text></Pressable>)}
      </> : <>
        <Text style={styles.heading}>인증 앱 등록하기</Text>
        <Text style={styles.text}>시간 기반 일회용 번호를 지원하는 인증 앱을 준비해주세요.</Text>
        {status.pending.map((factor) => <View key={factor.id}><Text style={styles.text}>완료되지 않은 등록이 있습니다.</Text>{button('미완료 등록 취소', async () => { await service.cancelPending(userId, factor.id); await refresh(); })}</View>)}
        {button('등록 시작', async () => { const next = await service.enroll(userId); if (active.current) { setEnrollment(next); setCode(''); } }, status.pending.length > 0)}
      </>}
      {enrollment || status.verified.length ? <>
        <Text style={styles.heading}>인증 앱의 6자리 번호</Text>
        <TextInput accessibilityLabel="6자리 인증 번호" style={styles.input} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} editable={!busy} autoCorrect={false} autoComplete="off" secureTextEntry />
        {button('번호 확인', async () => {
          const next = await service.verify(userId, enrollment?.id ?? factorId, code);
          if (active.current) { setEnrollment(null); setCode(''); setStatus(next); }
          await client.invalidateQueries({ queryKey: ['admin'] });
        }, code.length !== 6 || !(enrollment?.id ?? factorId))}
        {enrollment ? button('등록 취소', async () => { await service.cancelPending(userId, enrollment.id); if (active.current) { setEnrollment(null); setCode(''); } await refresh(); }) : null}
      </> : null}
    </View>}
    <View style={styles.card}><Text style={styles.heading}>인증 기기를 잃어버렸나요?</Text><Text style={styles.text}>인증 앱의 백업을 먼저 확인해주세요. 복원이 안 되면 서비스 운영자가 본인 확인 후 인증 등록을 초기화해야 합니다. 자동 복구나 복구 코드 발급은 아직 지원하지 않습니다.</Text><Text style={styles.text}>인증 앱을 삭제하거나 휴대폰을 바꾸기 전에 백업·복원 방법을 확인해주세요.</Text></View>
    <Pressable disabled={busy} onPress={() => router.replace('/admin')}><Text style={styles.link}>관리자 화면으로 돌아가기</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  title: { fontSize: 25, fontWeight: '800', color: '#322B27' },
  heading: { fontSize: 17, fontWeight: '700', color: '#322B27' },
  text: { fontSize: 14, lineHeight: 22, color: '#615952' },
  note: { padding: 12, backgroundColor: '#FFF0D6', color: '#755320', lineHeight: 21 },
  card: { padding: 18, gap: 14, borderRadius: 16, backgroundColor: '#FFFFFF' },
  button: { padding: 14, borderRadius: 12, backgroundColor: '#4F5E45', alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  input: { padding: 14, borderWidth: 1, borderColor: '#CFC7BD', borderRadius: 10, fontSize: 22, letterSpacing: 8 },
  emailInput: { padding: 14, borderWidth: 1, borderColor: '#CFC7BD', borderRadius: 10, fontSize: 16 },
  error: { color: '#A33220', lineHeight: 22 },
  link: { color: '#425C39', paddingVertical: 12, fontWeight: '700' },
  secret: { padding: 12, backgroundColor: '#F2F1EC', fontSize: 16 },
  qr: { width: 220, height: 220, alignSelf: 'center' },
});
