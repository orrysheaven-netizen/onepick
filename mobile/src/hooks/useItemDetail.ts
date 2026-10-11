import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AppError } from '@/errors/appError';
import type { PickChannel } from '@/lib/items/pickChannel';
import { queryKeys } from '@/lib/query/queryKeys';
import type { PickReadItem } from '@/repositories/interfaces/readRepository';
import { itemService, pickService } from '@/services';
import { itemPhotoCreditService } from '@/services/itemPhotoCreditService';

function retryItemDetail(failureCount: number, error: unknown) {
  if (error instanceof AppError && error.code === 'ITEM_NOT_FOUND') return false;
  return failureCount < 1;
}

export function useItemDetail(
  itemId: string | undefined,
  userId?: string,
  focusPickId?: string,
  includePhotoCredit = false,
  enabled = true,
  channel?: PickChannel,
  /** #757 pick detail store link; other detail screens skip the provider read. */
  includeProvider = false,
) {
  const queryClient = useQueryClient();
  type PickDetail = Awaited<ReturnType<typeof pickService.getPickDetail>>;
  const cachedFocus = focusPickId
    ? queryClient.getQueryData<PickDetail>(queryKeys.picks.detail(focusPickId, userId))
      ?? queryClient.getQueryData<PickDetail>(queryKeys.picks.detail(focusPickId))
    : undefined;
  const prefetchedFocus: PickReadItem | undefined = cachedFocus
    ? {
        pick: cachedFocus.pick,
        profile: cachedFocus.profile,
        category: cachedFocus.category,
        item: cachedFocus.item,
      }
    : undefined;

  const detail = useQuery({
    queryKey: [...queryKeys.items.detail(itemId ?? 'missing', userId), focusPickId ?? null, channel ?? null, includeProvider],
    queryFn: () => itemService.getItemDetail(itemId!, userId, focusPickId, prefetchedFocus, channel, includeProvider ? { includeProvider } : undefined),
    enabled: Boolean(itemId) && enabled,
    retry: retryItemDetail,
  });
  const item = detail.data?.item;
  const canReadCredit = Boolean(enabled && includePhotoCredit && itemId && item && item.id === itemId && item.imagePath
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
