import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import { registrationService } from '@/services';
import type { RegisterPickInput } from '@/services/registrationService';
import type { AttachItemPhotoInput } from '@/services/registrationService';

export function useRegistrationCategories() {
  return useQuery({ queryKey: ['categories', 'registration'], queryFn: () => registrationService.getCategories() });
}

export function useChoosePhoto() {
  return useMutation({ mutationFn: () => registrationService.choosePhoto() });
}

export function useImportItemPhoto() {
  return useMutation({ mutationFn: (url: string) => registrationService.importPhoto(url) });
}

export function useAttachItemPhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AttachItemPhotoInput) => registrationService.attachItemPhoto(input),
    onSuccess: () => invalidatePickData(client),
  });
}

export function useRegisterPick() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterPickInput) => registrationService.register(input),
    onSuccess: () => invalidatePickData(client),
  });
}
