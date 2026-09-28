import { withOnboardingParam, type OnboardingParam } from '@/lib/onboarding/navigation';

/** Where "pick something in this category" starts: catalog categories have their own finders. */
export function registrationRoute(category: { id: string; slug: string }, onboarding?: OnboardingParam) {
  const params = withOnboardingParam({ categoryId: category.id }, onboarding);
  switch (category.slug) {
    case 'music': return { pathname: '/pick/music' as const, params };
    case 'game': return { pathname: '/pick/game' as const, params };
    case 'book': return { pathname: '/pick/book' as const, params };
    case 'youtube': return { pathname: '/pick/youtube' as const, params };
    case 'recipe': return { pathname: '/pick/recipe' as const, params };
    case 'pokemon': return { pathname: '/pick/pokemon' as const, params };
    default: return { pathname: '/pick/find' as const, params };
  }
}
