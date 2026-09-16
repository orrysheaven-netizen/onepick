import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import { registrationService } from '@/services';
import type { RegisterPickInput } from '@/services/registrationService';

export function useRegistrationCategories() {
  return useQuery({ queryKey: ['registration', 'categories'], queryFn: () => registrationService.getCategories() });
}

export function useChoosePhoto() {
  return useMutation({ mutationFn: () => registrationService.choosePhoto() });
}

export function useImportProductPhoto() {
  return useMutation({ mutationFn: (url: string) => registrationService.importPhoto(url) });
}

export function useRegisterPick() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterPickInput) => registrationService.register(input),
    onSuccess: () => invalidatePickData(client),
  });
}
