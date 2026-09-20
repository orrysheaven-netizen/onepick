import { Text } from 'react-native';
import { useItemPickCount } from '@/hooks/useItemPickCount';
import { OnePick } from '@/constants/onepick';

export function ItemPickCount({ itemId }: { itemId: string }) {
  const query = useItemPickCount(itemId);
  const label = query.isError ? '원픽 인원을 확인하지 못했어요'
    : query.data === undefined ? '원픽 인원 확인 중…'
    : `현재 ${query.data.toLocaleString('ko-KR')}명이 원픽으로 선택`;
  return <Text style={{ color: OnePick.accent, fontSize: 13, fontWeight: '700', marginVertical: 8 }} accessibilityLabel={label}>{label}</Text>;
}
