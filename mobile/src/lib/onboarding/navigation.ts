export type OnboardingParam = string | string[] | undefined;

export function isOnboardingRoute(value: OnboardingParam) {
  return typeof value === 'string' && value === '1';
}

export function withOnboardingParam<T extends Record<string, string>>(
  params: T,
  onboarding: OnboardingParam,
): T & { onboarding?: '1' } {
  return isOnboardingRoute(onboarding) ? { ...params, onboarding: '1' } : params;
}
