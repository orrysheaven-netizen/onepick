import { Button } from './button';

export type PickButtonState = 'default' | 'change' | 'mine';

type Props = {
  state?: PickButtonState;
  onPress?: () => void;
  loading?: boolean;
  fullWidth?: boolean;
};

const labels: Record<PickButtonState, string> = {
  default: '원픽으로 고르기',
  change: '이걸로 원픽 바꾸기',
  mine: '내 원픽이에요',
};

export function PickButton({ state = 'default', onPress, loading, fullWidth = true }: Props) {
  return (
    <Button
      label={labels[state]}
      variant={state === 'default' ? 'primary' : state === 'change' ? 'secondary' : 'soft'}
      disabled={state === 'mine'}
      loading={loading}
      onPress={onPress}
      fullWidth={fullWidth}
    />
  );
}
