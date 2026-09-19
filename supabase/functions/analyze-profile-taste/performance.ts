export type ProfileAiServerOutcome =
  | 'auth_required' | 'invalid_tone' | 'not_configured' | 'forbidden'
  | 'not_enough_picks' | 'waiting_for_ten' | 'not_enough_changes' | 'stale' | 'rate_limited' | 'reused'
  | 'provider_failed' | 'generated' | 'failed';

type Tone = 'direct' | 'warm' | null;
type Input = {
  outcome: ProfileAiServerOutcome;
  tone: Tone;
  authMs: number | null;
  preflightMs: number | null;
  providerMs: number | null;
  saveMs: number | null;
  totalMs: number;
};

const OUTCOMES = new Set<ProfileAiServerOutcome>([
  'auth_required', 'invalid_tone', 'not_configured', 'forbidden',
  'not_enough_picks', 'waiting_for_ten', 'not_enough_changes', 'stale', 'rate_limited', 'reused',
  'provider_failed', 'generated', 'failed',
]);

function safeDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(120_000, Math.round(value))
    : null;
}

export function profileAiServerPerformanceEvent(input: Input) {
  return {
    event: 'profile_ai_generation',
    outcome: OUTCOMES.has(input.outcome) ? input.outcome : 'failed',
    tone: input.tone === 'direct' || input.tone === 'warm' ? input.tone : null,
    authMs: safeDuration(input.authMs),
    preflightMs: safeDuration(input.preflightMs),
    providerMs: safeDuration(input.providerMs),
    saveMs: safeDuration(input.saveMs),
    totalMs: safeDuration(input.totalMs) ?? 0,
  };
}

export function logProfileAiServerPerformance(
  input: Input,
  writer: (message: string) => void = (message) => console.info(message),
) {
  const event = profileAiServerPerformanceEvent(input);
  writer('AI_PROFILE_PERF ' + JSON.stringify(event));
  return event;
}
