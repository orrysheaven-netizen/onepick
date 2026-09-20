import { supabase } from '@/lib/supabase/client';

export type ProfileTasteCategory = {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  pickCount: number;
};

export type ProfileTasteDimension = {
  code: string;
  name: string;
  pickCount: number;
  categoryCount: number;
  percentage: number;
  categories: ProfileTasteCategory[];
};

export type ProfileTasteComposition = {
  profileId: string;
  totalPickCount: number;
  mappedPickCount: number;
  unmappedPickCount: number;
  dimensions: ProfileTasteDimension[];
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function parseCategory(value: unknown): ProfileTasteCategory | null {
  const row = recordValue(value);
  if (!row) return null;
  const categoryId = stringValue(row.category_id);
  const categoryName = stringValue(row.category_name);
  const categorySlug = stringValue(row.category_slug);
  if (!categoryId || !categoryName || !categorySlug) return null;

  return {
    categoryId,
    categoryName,
    categorySlug,
    pickCount: numberValue(row.pick_count),
  };
}

function parseDimension(value: unknown): ProfileTasteDimension | null {
  const row = recordValue(value);
  if (!row) return null;
  const code = stringValue(row.code);
  const name = stringValue(row.name);
  if (!code || !name) return null;

  return {
    code,
    name,
    pickCount: numberValue(row.pick_count),
    categoryCount: numberValue(row.category_count),
    percentage: numberValue(row.percentage),
    categories: arrayValue(row.categories)
      .map(parseCategory)
      .filter((category): category is ProfileTasteCategory => category !== null),
  };
}

class ProfileTasteCompositionService {
  async get(profileId: string): Promise<ProfileTasteComposition> {
    const { data, error } = await supabase.rpc('profile_taste_composition', {
      p_profile_id: profileId,
    });
    if (error) throw error;

    const root = recordValue(data);
    if (!root) throw new Error('PROFILE_TASTE_COMPOSITION_INVALID');

    return {
      profileId: stringValue(root.profile_id) ?? profileId,
      totalPickCount: numberValue(root.total_pick_count),
      mappedPickCount: numberValue(root.mapped_pick_count),
      unmappedPickCount: numberValue(root.unmapped_pick_count),
      dimensions: arrayValue(root.dimensions)
        .map(parseDimension)
        .filter((dimension): dimension is ProfileTasteDimension => dimension !== null),
    };
  }
}

export const profileTasteCompositionService = new ProfileTasteCompositionService();
