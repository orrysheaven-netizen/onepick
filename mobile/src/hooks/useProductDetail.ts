import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import { productService } from '@/services';

export function useProductDetail(productId: string | undefined, userId?: string) {
  return useQuery({
    queryKey: queryKeys.products.detail(productId ?? 'missing', userId),
    queryFn: () => productService.getProductDetail(productId!, userId),
    enabled: Boolean(productId),
  });
}
