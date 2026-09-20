import type { Category } from '@/types/domain/category';

export type OnboardingSequenceEvent = {
  categoryId: string;
  sequenceNo: number;
};

export type OnboardingSequenceInput = {
  categories: (Category & { label?: string })[];
  currentCategoryId?: string | null;
  handledCategoryIds: string[];
  events: OnboardingSequenceEvent[];
  userId: string;
};

// Keep the first choices universal and age-neutral. Alcohol categories remain
// available in the normal catalog but are not promoted as onboarding defaults.
const STARTER_SLUGS = ['ramen', 'movie'] as const;
const ONBOARDING_EXCLUDED_SLUGS = new Set(['alcohol', 'beer', 'soju']);

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function chooseOnboardingCategory(input: OnboardingSequenceInput) {
  const handled = new Set(input.handledCategoryIds);
  const available = input.categories.filter((category) =>
    category.isVisible
    && category.isPickable
    && category.status === 'open'
    && !ONBOARDING_EXCLUDED_SLUGS.has(category.slug)
    && !handled.has(category.id));

  if (input.currentCategoryId) {
    const current = available.find((category) => category.id === input.currentCategoryId);
    if (current) return current;
  }

  for (const slug of STARTER_SLUGS) {
    const starter = available.find((category) => category.slug === slug);
    if (starter) return starter;
  }

  if (!available.length) return null;

  const orderedEvents = [...input.events].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const previousId = orderedEvents.at(-1)?.categoryId;
  const previous = input.categories.find((category) => category.id === previousId);
  const diverse = previous
    ? available.filter((category) => (category.parentId ?? category.id) !== (previous.parentId ?? previous.id))
    : available;
  const pool = diverse.length ? diverse : available;
  const salt = `${input.userId}:${handled.size}:${orderedEvents.length}`;

  return [...pool].sort((a, b) =>
    stableHash(`${salt}:${a.id}`) - stableHash(`${salt}:${b.id}`))[0] ?? null;
}
