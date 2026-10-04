import { useQuery } from '@tanstack/react-query';
import { itemService } from '@/services';

/** Menu detail cards (Figma 45): "지역 ›" and "댓글 N". */
export function useMenuPickCardMeta(itemIds: string[], pickIds: string[]) {
  return useQuery({
    queryKey: ['menu', 'card-meta', [...itemIds].sort(), [...pickIds].sort()],
    queryFn: () => itemService.getMenuPickCardMeta(itemIds, pickIds),
    enabled: pickIds.length > 0,
    staleTime: 60_000,
  });
}
