import { useQuery } from '@tanstack/react-query';

import { AppError } from '@/errors/appError';
import { queryKeys } from '@/lib/query/queryKeys';
import { itemService } from '@/services';
import { itemPhotoCreditService } from '@/services/itemPhotoCreditService';

function retryItemDetail(failureCount: number, error: unknown) {
  if (error instanceof AppError && error.code === 'ITEM_NOT_FOUND') return false;
  return failureCount < 1;
}

export function useItemDetail(itemId: string | undefined, userId?: string, focusPickId?: string, includePhotoCredit = false) {
  const detail = useQuery({
    queryKey: [...queryKeys.items.detail(itemId ?? 'missing', userId), focusPickId ?? null],
    queryFn: () => itemService.getItemDetail(itemId!, userId, focusPickId),
    enabled: Boolean(itemId),
    retry: retryItemDetail,
  });
  const item = detail.data?.item;
  const canReadCredit = Boolean(includePhotoCredit && itemId && item && item.id === itemId && item.imagePath
    && !detail.isPending && !detail.isError && !detail.isFetching);
  // Attribution is optional and never delays or fails the product/review query.
  // Viewer and exact image revision stay under the existing items invalidation.
  const credit = useQuery({
    queryKey: [...queryKeys.items.all, 'photo-credit', itemId ?? 'missing', userId ?? 'public', item?.imagePath ?? null, item?.imageSourceUrl ?? null],
    queryFn: () => itemPhotoCreditService.get(itemId!),
    enabled: canReadCredit,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  const photoCredit = canReadCredit && !credit.isPending && !credit.isError && !credit.isFetching && credit.data
    && credit.data.itemId === itemId && credit.data.imagePath === item?.imagePath
    && credit.data.imageSourceUrl === (item?.imageSourceUrl ?? null) ? credit.data : null;
  return { ...detail, photoCredit };
}
