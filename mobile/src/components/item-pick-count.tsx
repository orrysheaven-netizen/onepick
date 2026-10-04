import { Text } from 'react-native';
import { useItemPickCount } from '@/hooks/useItemPickCount';
import { OnePick } from '@/constants/onepick';

const style = { color: OnePick.accent, fontSize: 13, fontWeight: '500', marginVertical: 8 } as const;

export function ItemPickCount({ itemId }: { itemId: string }) {
  const query = useItemPickCount(itemId);
  if (query.isError || query.data === undefined) {
    const label = query.isError ? '원픽 인원을 확인하지 못했어요.' : '원픽 인원 확인 중…';
    return <Text style={style} accessibilityLabel={label}>{label}</Text>;
  }
  const count = query.data.toLocaleString('ko-KR');
  // Only the number is bold: "12명이 원픽으로 선택".
  return <Text style={style} accessibilityLabel={`${count}명이 원픽으로 선택`}>
    <Text style={{ fontWeight: '800' }}>{count}</Text>명이 원픽으로 선택
  </Text>;
}
