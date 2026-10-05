const assert = require('node:assert/strict');
const { load, screen, names } = require('./mvp-screen-harness.cjs');
const constants = load('constants/onepick.ts', { './font-family': load('constants/font-family.ts') });

const category = {
  id: 'soup', slug: 'miyeokguk', name: '미역국',
  status: 'open', isVisible: true, isPickable: true,
};

function query(data) {
  return {
    data, isPending: false, isSuccess: true, isError: false, isFetching: false,
    refetch() { return Promise.resolve(); },
  };
}

const calls = {};
const view = screen('app/menu/[slug].tsx', {
  'expo-router': {
    useRouter: () => ({
      canGoBack: () => true,
      back: () => { calls.route = 'back'; },
      replace: (route) => { calls.route = route; },
    }),
    useLocalSearchParams: () => ({ slug: 'miyeokguk' }),
  },
  'expo-router/head': { default: 'Head' },
  '@/constants/onepick': constants,
  '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'viewer' } }) },
  '@/hooks/useDishPicks': { useDishPicks: () => ({ isSuccess: false, data: [] }), useMyDishPicks: () => ({ data: [] }) },
  '@/hooks/useExploreData': { useCategoryBySlug: (slug) => { calls.slug = slug; return query(category); } },
  '@/components/dish-people-picks': names('DishPeoplePicks'),
});

view.render();
assert.equal(calls.slug, 'miyeokguk');
assert.match(view.text(), /미역국/);
assert.doesNotMatch(view.text(), /지금 원픽으로 고른 사람들의 한줄평/, 'Figma 16A removes the explanatory intro from the primary viewport');
const people = view.find('DishPeoplePicks');
assert.equal(people.categoryId, 'soup');
assert.equal(people.categoryName, '미역국');
assert.equal(people.userId, 'viewer');
assert.equal(people.menuContext, undefined, 'Figma 16A owns its row hierarchy instead of the legacy D card hierarchy');
assert.equal(people.fixedChannel, 'offline', 'Initial MVP menu view exposes physical-store Picks only');
assert.equal(people.variant, 'menuDetail', 'Dedicated menu route uses the Figma 16A production rows');

view.find('Pressable', (p) => p.accessibilityLabel === '뒤로 가기').onPress();
assert.equal(calls.route, 'back');

console.log('Menu route passed: category resolution, Figma 16A production handoff and back navigation.');
