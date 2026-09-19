import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminItemInput,
} from '@/repositories/interfaces/adminRepository';
import { adminService } from '@/services';

const adminKeys = {
  all: ['admin'] as const,
  dashboard: (userId?: string) => ['admin', 'dashboard', userId] as const,
};

async function invalidateAdminData(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: adminKeys.all }),
    client.invalidateQueries({ queryKey: queryKeys.items.all }),
    client.invalidateQueries({ queryKey: queryKeys.categories.all }),
    client.invalidateQueries({ queryKey: queryKeys.home.all }),
    client.invalidateQueries({ queryKey: queryKeys.explore.all }),
    client.invalidateQueries({ queryKey: queryKeys.profiles.all }),
    client.invalidateQueries({ queryKey: queryKeys.picks.all }),
  ]);
}

export function useAdminAccess(userId?: string) {
  return useQuery({ queryKey: ['admin', 'access', userId], queryFn: () => adminService.isAdmin(), enabled: Boolean(userId), retry: false });
}

export function useAdminDashboard(userId?: string) {
  return useQuery({
    queryKey: adminKeys.dashboard(userId),
    queryFn: () => adminService.getDashboard(),
    enabled: Boolean(userId),
    retry: false,
  });
}

export function useAdminActions() {
  const client = useQueryClient();
  const after = () => invalidateAdminData(client);

  const createCategory = useMutation({ mutationFn: (input: AdminCategoryInput) => adminService.createCategory(input), onSuccess: after });
  const createBrand = useMutation({ mutationFn: (input: AdminBrandInput) => adminService.createBrand(input), onSuccess: after });
  const updateCategory = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AdminCategoryInput> }) => adminService.updateCategory(id, input),
    onSuccess: after,
  });
  const createItem = useMutation({ mutationFn: (input: AdminItemInput) => adminService.createItem(input), onSuccess: after });
  const updateItem = useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: Partial<AdminItemInput> }) => adminService.updateItem(itemId, input),
    onSuccess: after,
  });
  const addItemAlias = useMutation({
    mutationFn: ({ itemId, alias }: { itemId: string; alias: string }) => adminService.addItemAlias(itemId, alias),
    onSuccess: after,
  });
  const removeItemAlias = useMutation({ mutationFn: (aliasId: string) => adminService.removeItemAlias(aliasId), onSuccess: after });
  const approveItem = useMutation({
    mutationFn: ({ itemId, edits }: { itemId: string; edits?: Partial<AdminItemInput> }) => adminService.approveItem(itemId, edits),
    onSuccess: after,
  });
  const rejectItem = useMutation({ mutationFn: (itemId: string) => adminService.rejectItem(itemId), onSuccess: after });
  const mergeItem = useMutation({
    mutationFn: ({ itemId, targetItemId }: { itemId: string; targetItemId: string }) => adminService.mergeItem(itemId, targetItemId),
    onSuccess: after,
  });
  const hideItem = useMutation({ mutationFn: (itemId: string) => adminService.hideItem(itemId), onSuccess: after });

  return {
    createCategory,
    updateCategory,
    createBrand,
    createItem,
    updateItem,
    addItemAlias,
    removeItemAlias,
    approveItem,
    rejectItem,
    mergeItem,
    hideItem,
  };
}
