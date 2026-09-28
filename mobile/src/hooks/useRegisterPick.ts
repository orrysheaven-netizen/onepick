import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidatePickData } from '@/lib/query/invalidatePickData';
import { observabilityService, registrationService } from '@/services';
import type { ImmediatePickRegistrationInput, RegisterPickInput } from '@/services/registrationService';
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

export function useRegisterItemPick() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ImmediatePickRegistrationInput) => registrationService.registerImmediatePick(input),
    onSuccess: (result, input) => {
      invalidatePickData(client);
      void observabilityService.captureProductEvent({
        eventName: 'pick_created',
        pickId: result.pickId,
        itemId: result.itemId,
        categoryId: input.categoryId,
        source: 'register_item_pick',
        path: '/pick/new',
      });
    },
  });
}

export function useRegisterPick() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterPickInput) => registrationService.register(input),
    onSuccess: (result) => {
      invalidatePickData(client);
      if (result.type === 'pick') {
        void observabilityService.captureProductEvent({
          eventName: 'pick_created',
          pickId: result.pick.id,
          itemId: result.pick.itemId,
          categoryId: result.pick.categoryId,
          source: 'register_pick',
          path: '/pick/register',
        });
      }
    },
  });
}
