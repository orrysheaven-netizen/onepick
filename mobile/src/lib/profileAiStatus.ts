/** Presence of server configuration is not proof of provider access or billing. */
export type ProfileAiStatus = { configured: boolean };

export function parseProfileAiStatus(value: unknown): ProfileAiStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_STATUS_INVALID');
  const data = value as Record<string, unknown>;
  if (data.service !== 'analyze-profile-taste' || data.status !== 'ok' || typeof data.configured !== 'boolean') {
    throw new Error('AI_STATUS_INVALID');
  }
  // Keep only the public boolean. Never cache unexpected response fields.
  return { configured: data.configured };
}

export async function readProfileAiStatus(
  baseUrl: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<ProfileAiStatus> {
  const { signal, fetcher = fetch, timeoutMs = 8000 } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('AI_STATUS_TIMEOUT_INVALID');
  if (signal?.aborted) throw new Error('AI_STATUS_CANCELLED');
  const endpoint = new URL('/functions/v1/analyze-profile-taste/status', baseUrl).toString();
  const controller = new AbortController();
  let rejectAbort!: (reason: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = (reason: string) => {
    controller.abort();
    rejectAbort(new Error(reason));
  };
  const onAbort = () => abort('AI_STATUS_CANCELLED');
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => abort('AI_STATUS_TIMEOUT'), timeoutMs);
  try {
    const request = (async () => {
      // Public GET only: no access token, API key, user ID or model input.
      const response = await fetcher(endpoint, {
        method: 'GET', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error('AI_STATUS_UNAVAILABLE');
      return parseProfileAiStatus(await response.json());
    })();
    // Bound the JSON read too, including fetch implementations ignoring abort.
    return await Promise.race([request, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function canRequestProfileAiGeneration(input: {
  isOwner: boolean; publicPickCount: number; minimumPickCount: number;
  configured: boolean | undefined; statusError: boolean; statusPending: boolean;
}): boolean {
  return input.isOwner && Number.isInteger(input.publicPickCount) &&
    input.publicPickCount >= input.minimumPickCount && input.configured === true &&
    !input.statusError && !input.statusPending;
}
