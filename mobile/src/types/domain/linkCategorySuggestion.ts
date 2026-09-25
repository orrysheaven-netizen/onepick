export type LinkSuggestionKind = 'place' | 'online';

export type LinkSuggestedCategory = {
  categoryId: string;
  label: string;
  name: string;
  reason: string;
};

export type LinkCategoryOption = {
  categoryId: string;
  label: string;
  name: string;
};

export type LinkPlaceMatch = {
  catalogId: string;
  name: string;
  branchName: string | null;
  roadAddress: string | null;
  address: string | null;
  region1: string | null;
  region2: string | null;
  providerCategory: string | null;
};

export type LinkCategorySuggestionResult = {
  kind: LinkSuggestionKind;
  inputUrl: string;
  canonicalUrl: string;
  host: string;
  title: string | null;
  description: string | null;
  resolvedName: string | null;
  needsName: boolean;
  places: LinkPlaceMatch[];
  suggestions: LinkSuggestedCategory[];
  categories: LinkCategoryOption[];
};

export type LinkCategorySuggestionInput = {
  url: string;
  name?: string;
  placeCatalogId?: string;
};
