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
  access: ['admin', 'access'] as const,
  dashboard: ['admin', 'dashboard'] as const,
};

async function invalidateAdminData(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: adminKeys.all }),
    client.invalidateQueries({ queryKey: queryKeys.products.all }),
    client.invalidateQueries({ queryKey: queryKeys.categories.all }),
    client.invalidateQueries({ queryKey: queryKeys.profiles.all }),
  ]);
}

export function useAdminAccess(enabled = true) {
  return useQuery({
    queryKey: adminKeys.access,
    queryFn: () => adminService.isAdmin(),
    enabled,
    retry: false,
  });
}

export function useAdminDashboard(enabled = true) {
  return useQuery({
    queryKey: adminKeys.dashboard,
    queryFn: () => adminService.getDashboard(),
    enabled,
    retry: false,
  });
}

export function useAdminActions() {
  const client = useQueryClient();
  const after = () => invalidateAdminData(client);

  const createCategory = useMutation({
    mutationFn: (input: AdminCategoryInput) => adminService.createCategory(input),
    onSuccess: after,
  });
  const createBrand = useMutation({
    mutationFn: (input: AdminBrandInput) => adminService.createBrand(input),
    onSuccess: after,
  });
  const createProduct = useMutation({
    mutationFn: (input: AdminProductInput) => adminService.createProduct(input),
    onSuccess: after,
  });
  const approveProduct = useMutation({
    mutationFn: ({ productId, edits }: { productId: string; edits?: Partial<AdminProductInput> }) =>
      adminService.approveProduct(productId, edits),
    onSuccess: after,
  });
  const rejectProduct = useMutation({
    mutationFn: (productId: string) => adminService.rejectProduct(productId),
    onSuccess: after,
  });
  const mergeProduct = useMutation({
    mutationFn: ({ productId, targetProductId }: { productId: string; targetProductId: string }) =>
      adminService.mergeProduct(productId, targetProductId),
    onSuccess: after,
  });
  const hideProduct = useMutation({
    mutationFn: (productId: string) => adminService.hideProduct(productId),
    onSuccess: after,
  });

  return {
    createCategory,
    createBrand,
    createProduct,
    approveProduct,
    rejectProduct,
    mergeProduct,
    hideProduct,
  };
}