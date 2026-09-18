import { useQuery } from '@tanstack/react-query';

import { adminService } from '@/services';

export function useAdminAccess(userId?: string) {
  return useQuery({ queryKey: ['admin', 'access', userId], queryFn: () => adminService.isAdmin(), enabled: Boolean(userId), retry: false });
}
