import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { observabilityService } from '@/services';

import { capturedErrorCode, createErrorCaptureGate, errorCaptureContext } from './errorCapture';

// Every failed query or mutation used to vanish unless its screen reported it. Record the
// unexpected ones centrally so "no user-facing errors" can actually be measured.
const shouldCapture = createErrorCaptureGate();

function captureFailure(error: unknown, context: string) {
  const code = capturedErrorCode(error);
  if (!code || !shouldCapture(`${context}|${code}`, Date.now())) return;
  void observabilityService.captureError(error, context);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => captureFailure(error, errorCaptureContext('query', query.queryKey)),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _onMutateResult, mutation) =>
      captureFailure(error, errorCaptureContext('mutation', mutation.options.mutationKey)),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
