import { Redirect, useLocalSearchParams } from 'expo-router';

type Params = {
  categoryId?: string | string[];
  itemId?: string | string[];
  itemName?: string | string[];
};

const scalar = (value: string | string[] | undefined) => typeof value === 'string' ? value : undefined;

// Kept as a compatibility route for old shared/auth-return links.
// New registration is split into search -> choose for known items and
// search -> request for products that are not in the catalog.
export default function RegisterPickCompatibilityRoute() {
  const params = useLocalSearchParams<Params>();
  const categoryId = scalar(params.categoryId);
  const itemId = scalar(params.itemId);
  const itemName = scalar(params.itemName)?.trim();

  if (itemId && categoryId) {
    return <Redirect href={{ pathname: '/pick/choose', params: { itemId, categoryId } }} />;
  }

  return <Redirect href={{
    pathname: '/pick/find',
    params: {
      ...(categoryId ? { categoryId } : {}),
      ...(itemName ? { query: itemName } : {}),
    },
  }} />;
}
