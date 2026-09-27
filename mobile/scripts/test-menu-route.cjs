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
  '@/hooks/useExploreData': { useCategoryBySlug: (slug) => { calls.slug = slug; return query(category); } },
  '@/components/dish-people-picks': names('DishPeoplePicks'),
});

view.render();
assert.equal(calls.slug, 'miyeokguk');
assert.match(view.text(), /미역국/);
assert.match(view.text(), /지금 원픽으로 고른 사람들의 한줄평/);
const people = view.find('DishPeoplePicks');
assert.equal(people.categoryId, 'soup');
assert.equal(people.categoryName, '미역국');
assert.equal(people.userId, 'viewer');
assert.equal(people.menuContext, true, 'Dedicated menu view uses D hierarchy and does not repeat the menu title in each card');

view.find('Pressable', (p) => p.accessibilityLabel === '뒤로 가기').onPress();
assert.equal(calls.route, 'back');

console.log('Menu route passed: category resolution, D hierarchy handoff and back navigation.');
