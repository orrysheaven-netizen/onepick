import type { ProfileAiTone } from '@/lib/profileAiTone';

export type ProfileAiClientOutcome =
  | 'success' | 'auth_required' | 'forbidden' | 'not_configured'
  | 'incompatible' | 'not_enough_picks' | 'stale' | 'rate_limited'
  | 'eligibility_failed' | 'status_unavailable' | 'cancelled' | 'failed';

type Input = {
  tone: ProfileAiTone;
  outcome: ProfileAiClientOutcome;
  preflightMs: number | null;
  generationMs: number | null;
  totalMs: number;
};

const OUTCOMES = new Set<ProfileAiClientOutcome>([
  'success', 'auth_required', 'forbidden', 'not_configured', 'incompatible',
  'not_enough_picks', 'stale', 'rate_limited', 'eligibility_failed',
  'status_unavailable', 'cancelled', 'failed',
]);

function safeDuration(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(120_000, Math.round(value))
    : null;
}

export function profileAiClientOutcomeFromCode(code: string | null | undefined): ProfileAiClientOutcome {
  switch (code) {
    case 'AUTH_REQUIRED': return 'auth_required';
    case 'FORBIDDEN': return 'forbidden';
    case 'AI_NOT_CONFIGURED': return 'not_configured';
    case 'AI_NOT_ENOUGH_PICKS': return 'not_enough_picks';
    case 'AI_REVIEW_STALE': return 'stale';
    case 'RATE_LIMITED': return 'rate_limited';
    default: return 'failed';
  }
}

export function profileAiClientPerformanceEvent(input: Input) {
  return {
    event: 'profile_ai_generation_ui',
    outcome: OUTCOMES.has(input.outcome) ? input.outcome : 'failed',
    tone: input.tone === 'direct' || input.tone === 'warm' ? input.tone : 'direct',
    preflightMs: safeDuration(input.preflightMs),
    generationMs: safeDuration(input.generationMs),
    totalMs: safeDuration(input.totalMs) ?? 0,
  };
}

export function logProfileAiClientPerformance(
  input: Input,
  writer: (message: string) => void = (message) => console.info(message),
) {
  const event = profileAiClientPerformanceEvent(input);
  writer('[OnePick:ai_profile_perf] ' + JSON.stringify(event));
  return event;
}
