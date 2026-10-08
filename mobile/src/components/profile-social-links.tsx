import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuthSession } from '@/hooks/useAuthSession';
import { DIALOG_CANCEL_LABEL } from '@/components/ui/dialog-labels';
import { useChangeSocialLink, useSocialLinks } from '@/hooks/useSocialLinks';
import { normalizeSocialLink, SOCIAL_PLATFORMS, SocialLinkValidationError } from '@/lib/socialLinks';
import type { SocialLink, SocialPlatform } from '@/lib/socialLinks';
import { OnePick } from '@/constants/onepick';

type Props = { profileUserId: string; editable?: boolean };

export function ProfileSocialLinks({ profileUserId, editable = false }: Props) {
  const auth = useAuthSession();
  // Never carry an editor or viewer-specific cached links across account changes.
  if (auth.isLoading || auth.error) return null;
  return <SocialLinksContent key={`${profileUserId}:${auth.user?.id ?? 'anonymous'}`}
    profileUserId={profileUserId} viewerId={auth.user?.id}
    editable={editable && auth.user?.id === profileUserId} />;
}

function SocialLinksContent({ profileUserId, viewerId, editable }: Props & { viewerId?: string }) {
  const query = useSocialLinks(profileUserId, viewerId);
  const mutation = useChangeSocialLink(profileUserId, viewerId);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<SocialPlatform | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const links = query.data ?? [];
  const busy = mutation.isPending;

  const edit = (platform: SocialPlatform) => {
    if (inFlight.current) return;
    setEditing(platform);
    setInput(links.find((link) => link.platform === platform)?.url ?? '');
    setError(''); setMessage('');
  };
  const change = async (remove = false) => {
    if (!editing || !editable || inFlight.current) return;
    inFlight.current = true;
    setError(''); setMessage('');
    try {
      await mutation.mutateAsync(remove ? { platform: editing, remove: true } : { platform: editing, input });
      setEditing(null); setInput('');
      setMessage(remove ? 'SNS 연결을 해제했어요.' : 'SNS 링크를 저장했어요.');
    } catch (cause) {
      setError(cause instanceof SocialLinkValidationError ? cause.message : '변경하지 못했어요. 로그인과 연결 상태를 확인한 뒤 다시 시도해주세요.');
    } finally { inFlight.current = false; }
  };
  const open = async (link: SocialLink) => {
    setError('');
    try {
      const url = normalizeSocialLink(link.platform, link.url);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
      else await Linking.openURL(url);
    } catch { setError('SNS 링크를 열지 못했어요. 다시 시도해주세요.'); }
  };

  if (!editable && !query.isPending && !query.isError && links.length === 0) return null;
  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <Text style={styles.title}>SNS</Text>
        {editable ? <Pressable accessibilityRole="button" accessibilityLabel="SNS 연결 관리"
          disabled={busy || query.isPending || query.isError}
          onPress={() => { setExpanded(!expanded); setEditing(null); setError(''); setMessage(''); }}
          style={({ pressed }) => [styles.manage, (pressed || busy || query.isPending || query.isError) && styles.disabled]}>
          <Text style={styles.action}>{expanded ? '닫기' : links.length ? 'SNS 수정' : 'SNS 연결'}</Text>
        </Pressable> : null}
      </View>
      {query.isPending ? <ActivityIndicator accessibilityLabel="SNS 링크 불러오는 중" /> : null}
      {query.isError ? <View>
        <Text accessibilityRole="alert" style={styles.error}>SNS 링크를 불러오지 못했어요.</Text>
        <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.manage}>
          <Text style={styles.action}>다시 불러오기</Text>
        </Pressable>
      </View> : null}
      {!query.isPending && !query.isError ? <>
        {links.length ? <View style={styles.links}>
          {SOCIAL_PLATFORMS.map((platform) => {
            const link = links.find((item) => item.platform === platform.id);
            return link ? <Pressable key={platform.id} accessibilityRole="link"
              accessibilityLabel={`${platform.label} 프로필 열기 (외부 링크)`}
              onPress={() => void open(link)} style={({ pressed }) => [styles.chip, pressed && styles.disabled]}>
              <Text style={styles.chipText}>{platform.label} ↗</Text>
            </Pressable> : null;
          })}
        </View> : editable ? <Text style={styles.hint}>공유하고 싶은 SNS 프로필을 연결해보세요. 선택사항이에요.</Text> : null}
        {expanded && editable ? <View style={styles.editor}>
          <Text style={styles.hint}>등록한 링크는 누구나 볼 수 있어요. SNS 로그인이나 계정 인증은 하지 않아요.</Text>
          {SOCIAL_PLATFORMS.map((platform) => {
            const saved = links.find((item) => item.platform === platform.id);
            return <View key={platform.id} style={styles.row}>
              <View style={styles.rowHeading}>
                <View style={styles.rowCopy}>
                  <Text style={styles.label}>{platform.label}</Text>
                  {saved ? <Text numberOfLines={1} style={styles.url}>{saved.url}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`${platform.label} ${saved ? '수정' : '연결'}`}
                  disabled={busy} onPress={() => edit(platform.id)} style={[styles.manage, busy && styles.disabled]}>
                  <Text style={styles.action}>{saved ? '수정' : '연결'}</Text>
                </Pressable>
              </View>
              {editing === platform.id ? <View style={styles.form}>
                <TextInput accessibilityLabel={`${platform.label} 사용자명 또는 프로필 주소`}
                  placeholder={platform.example} value={input} onChangeText={setInput}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={512}
                  editable={!busy} style={styles.input} />
                <Text style={styles.hint}>사용자명 또는 프로필 주소를 입력해주세요. 게시물 주소는 연결할 수 없어요.</Text>
                <View style={styles.buttons}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${platform.label} 링크 저장`}
                    disabled={busy || !input.trim()} onPress={() => void change()}
                    style={[styles.save, (busy || !input.trim()) && styles.disabled]}>
                    <Text style={styles.saveText}>{busy ? '처리 중…' : '저장하기'}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setEditing(null); setError(''); }}
                    style={[styles.manage, busy && styles.disabled]}><Text style={styles.action}>{DIALOG_CANCEL_LABEL}</Text></Pressable>
                  {saved ? <Pressable accessibilityRole="button" accessibilityLabel={`${platform.label} 연결 해제`}
                    disabled={busy} onPress={() => void change(true)} style={[styles.manage, busy && styles.disabled]}>
                    <Text style={styles.remove}>연결 해제</Text>
                  </Pressable> : null}
                </View>
              </View> : null}
            </View>;
          })}
        </View> : null}
      </> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border, borderRadius: 20, padding: 16, marginBottom: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  title: { fontSize: 15, fontWeight: '800', color: OnePick.text },
  manage: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignSelf: 'flex-start' },
  action: { color: OnePick.accent, fontSize: 13, fontWeight: '700' },
  hint: { color: OnePick.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { minHeight: 44, backgroundColor: OnePick.background, borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center' },
  chipText: { color: OnePick.text, fontSize: 12, fontWeight: '700' },
  editor: { marginTop: 8 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: OnePick.border, paddingTop: 8, marginTop: 12 },
  rowHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowCopy: { flex: 1 },
  label: { color: OnePick.text, fontSize: 13, fontWeight: '700' },
  url: { color: OnePick.muted, fontSize: 12, marginTop: 4 },
  form: { marginTop: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: OnePick.border, borderRadius: 12, paddingHorizontal: 12, color: OnePick.text, backgroundColor: OnePick.sunken, fontSize: 14 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  save: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: OnePick.accent, justifyContent: 'center' },
  saveText: { color: OnePick.onAccent, fontSize: 13, fontWeight: '800' },
  remove: { color: OnePick.danger, fontSize: 12 },
  error: { color: OnePick.danger, fontSize: 12, lineHeight: 18, marginTop: 8 },
  disabled: { opacity: 0.5 },
});
