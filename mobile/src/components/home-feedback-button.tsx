import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Button } from '@/components/ui';
import { OnePick } from '@/constants/onepick';
import { useFeedbackEmail } from '@/hooks/useFeedbackEmail';
import { feedbackMailto } from '@/lib/feedback/email';

// The Home owner (#777) mounts this beside the invitation action after the
// settings migration is deployed. A missing setting never opens a fake address.
export function HomeFeedbackButton({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const query = useFeedbackEmail();
  const [error, setError] = useState('');
  const email = query.data;
  if (!email || query.isError) return null;
  const open = () => {
    const url = feedbackMailto(email);
    if (!url) return;
    setError('');
    void Linking.openURL(url).catch(() => setError(`메일 앱을 열지 못했어요. ${email}로 의견을 보내주세요.`));
  };
  return <View style={style}>
    <Button variant="secondary" fullWidth label="의견을 보내요" onPress={open} />
    {error ? <Text selectable accessibilityRole="alert" style={{ color: OnePick.textSecondary }}>{error}</Text> : null}
  </View>;
}
