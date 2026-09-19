export const EXPECTED_PROFILE_AI_CONTRACT_VERSION = 'profile-ai-v2';
export const EXPECTED_PROFILE_AI_MIN_PICKS = 10;
export const EXPECTED_PROFILE_AI_PROMPT_VERSION = 'taste-v5-no-age';
export const EXPECTED_PROFILE_AI_COOLDOWN_SECONDS = 10 * 60;

export type ProfileAiStatus = {
  configured: boolean;
  compatible: boolean;
  contractVersion: string | null;
  minimumPicks: number | null;
  promptVersion: string | null;
  cooldownSeconds: number | null;
};

export function parseProfileAiStatus(value: unknown): ProfileAiStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI_STATUS_INVALID');
  const data = value as Record<string, unknown>;
  if (data.service !== 'analyze-profile-taste' || data.status !== 'ok' || typeof data.configured !== 'boolean') {
    throw new Error('AI_STATUS_INVALID');
  }
  const contractFields = ['contractVersion', 'minimumPicks', 'promptVersion', 'cooldownSeconds'] as const;
  const present = contractFields.filter((key) => data[key] !== undefined).length;
  if (present === 0) {
    // Legacy deployed server: reachable/configured is not enough to enable generation.
    return { configured: data.configured, compatible: false, contractVersion: null,
      minimumPicks: null, promptVersion: null, cooldownSeconds: null };
  }
  if (present !== contractFields.length || typeof data.contractVersion !== 'string' ||
    !Number.isSafeInteger(data.minimumPicks) || Number(data.minimumPicks) < 1 ||
    typeof data.promptVersion !== 'string' || !data.promptVersion ||
    !Number.isSafeInteger(data.cooldownSeconds) || Number(data.cooldownSeconds) < 1) {
    throw new Error('AI_STATUS_INVALID');
  }
  const contractVersion = data.contractVersion as string;
  const minimumPicks = Number(data.minimumPicks);
  const promptVersion = data.promptVersion as string;
  const cooldownSeconds = Number(data.cooldownSeconds);
  return {
    configured: data.configured,
    compatible: contractVersion === EXPECTED_PROFILE_AI_CONTRACT_VERSION &&
      minimumPicks === EXPECTED_PROFILE_AI_MIN_PICKS &&
      promptVersion === EXPECTED_PROFILE_AI_PROMPT_VERSION &&
      cooldownSeconds === EXPECTED_PROFILE_AI_COOLDOWN_SECONDS,
    contractVersion, minimumPicks, promptVersion, cooldownSeconds,
  };
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
      const response = await fetcher(endpoint, {
        method: 'GET', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error('AI_STATUS_UNAVAILABLE');
      return parseProfileAiStatus(await response.json());
    })();
    return await Promise.race([request, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function canRequestProfileAiGeneration(input: {
  isOwner: boolean; publicPickCount: number; minimumPickCount: number;
  configured: boolean | undefined; compatible: boolean | undefined;
  statusError: boolean; statusPending: boolean;
}): boolean {
  return input.isOwner && Number.isInteger(input.publicPickCount) &&
    input.publicPickCount >= input.minimumPickCount && input.configured === true &&
    input.compatible === true && !input.statusError && !input.statusPending;
}
