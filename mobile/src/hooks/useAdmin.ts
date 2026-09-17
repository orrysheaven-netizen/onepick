import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query/queryKeys';
import type {
  AdminBrandInput,
  AdminCategoryInput,
  AdminProductInput,
} from '@/repositories/interfaces/adminRepository';
import { adminService } from '@/services';

const adminKeys = {
  all: ['admin'] as const,
  dashboard: (userId?: string) => ['admin', 'dashboard', userId] as const,
  operations: (userId?: string) => ['admin', 'operations', userId] as const,
};

async function invalidateAdminData(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: adminKeys.all }),
    client.invalidateQueries({ queryKey: queryKeys.products.all }),
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

export function useAdminOperations(userId?: string) {
  return useQuery({
    queryKey: adminKeys.operations(userId),
    queryFn: () => adminService.getOperationsOverview(),
    enabled: Boolean(userId),
    retry: false,
    staleTime: 15_000,
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
  const createProduct = useMutation({ mutationFn: (input: AdminProductInput) => adminService.createProduct(input), onSuccess: after });
  const updateProduct = useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: Partial<AdminProductInput> }) => adminService.updateProduct(productId, input),
    onSuccess: after,
  });
  const addProductAlias = useMutation({
    mutationFn: ({ productId, alias }: { productId: string; alias: string }) => adminService.addProductAlias(productId, alias),
    onSuccess: after,
  });
  const removeProductAlias = useMutation({ mutationFn: (aliasId: string) => adminService.removeProductAlias(aliasId), onSuccess: after });
  const approveProduct = useMutation({
    mutationFn: ({ productId, edits }: { productId: string; edits?: Partial<AdminProductInput> }) => adminService.approveProduct(productId, edits),
    onSuccess: after,
  });
  const rejectProduct = useMutation({ mutationFn: (productId: string) => adminService.rejectProduct(productId), onSuccess: after });
  const mergeProduct = useMutation({
    mutationFn: ({ productId, targetProductId }: { productId: string; targetProductId: string }) => adminService.mergeProduct(productId, targetProductId),
    onSuccess: after,
  });
  const hideProduct = useMutation({ mutationFn: (productId: string) => adminService.hideProduct(productId), onSuccess: after });

  return {
    createCategory,
    updateCategory,
    createBrand,
    createProduct,
    updateProduct,
    addProductAlias,
    removeProductAlias,
    approveProduct,
    rejectProduct,
    mergeProduct,
    hideProduct,
  };
}
