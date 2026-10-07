import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { armFirstPickNotice, captureTrustedCurrentPicks } from '@/lib/home/firstPickNotice';
import { invalidatePickData } from '@/lib/query/invalidatePickData';
import { observabilityService, registrationService } from '@/services';
import type { ImmediatePickRegistrationInput, RegisterPickInput, RevisePendingItemInput } from '@/services/registrationService';
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

/** L4: my own photo for this item waiting for admin review (only I can read it). */
export function useMyPendingItemPhoto(itemId: string | undefined, userId: string | undefined, enabled = true) {
  return useQuery({
    // Under the items prefix, so invalidatePickData refreshes it after an upload.
    queryKey: ['items', 'my-pending-photo', itemId ?? 'missing', userId ?? 'missing'],
    queryFn: () => registrationService.getMyPendingItemPhoto(userId!, itemId!),
    enabled: enabled && Boolean(itemId && userId),
    retry: false,
  });
}

export function useRevisePendingItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RevisePendingItemInput) => registrationService.revisePendingItem(input),
    onSuccess: () => invalidatePickData(client),
  });
}

export function useReadCurrentPickSlot() {
  return useMutation({
    mutationFn: (input: { userId: string; categoryId: string; channel: import('@/lib/items/pickChannel').PickChannel }) =>
      registrationService.getCurrentPickSlot(input.userId, input.categoryId, input.channel),
  });
}

export function useRegisterItemPick() {
  const client = useQueryClient();
  return useMutation({
    onMutate: (input: ImmediatePickRegistrationInput) => ({ priorPicks: captureTrustedCurrentPicks(client).get(input.userId) ?? null }),
    mutationFn: (input: ImmediatePickRegistrationInput) => registrationService.registerImmediatePick(input),
    onSuccess: (result, input, context) => {
      armFirstPickNotice(input.userId, result.pickId, context?.priorPicks);
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
    onMutate: (input: RegisterPickInput) => ({ priorPicks: captureTrustedCurrentPicks(client).get(input.userId) ?? null }),
    mutationFn: (input: RegisterPickInput) => registrationService.register(input),
    onSuccess: (result, _input, context) => {
      invalidatePickData(client);
      if (result.type === 'pick') {
        armFirstPickNotice(result.pick.userId, result.pick.id, context?.priorPicks);
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

