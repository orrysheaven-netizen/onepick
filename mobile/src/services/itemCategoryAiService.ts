import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

export type ItemCategoryConfidence = 'high' | 'medium' | 'low';

export type ItemCategorySuggestion = {
  categoryId: string;
  label: string;
  reason: string;
  confidence: ItemCategoryConfidence;
};

export type ItemCategoryOption = {
  categoryId: string;
  label: string;
};

export type ItemCategorySuggestions = {
  itemId: string;
  suggestions: ItemCategorySuggestion[];
  categories: ItemCategoryOption[];
  needsNewCategory: boolean;
  reused: boolean;
};

export type AppliedItemCategory =
  | { type: 'classified'; itemId: string; categoryId: string }
  | { type: 'existing_item'; itemId: string; categoryId: string };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ITEM_CATEGORY_AI_INVALID');
  return value;
}

function parseSuggestions(value: unknown): ItemCategorySuggestions {
  const data = object(value);
  const itemId = requiredString(data.itemId);
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions.map((entry) => {
    const item = object(entry);
    const confidence = item.confidence;
    if (!['high', 'medium', 'low'].includes(String(confidence))) throw new Error('ITEM_CATEGORY_AI_INVALID');
    return {
      categoryId: requiredString(item.categoryId),
      label: requiredString(item.label),
      reason: requiredString(item.reason),
      confidence: confidence as ItemCategoryConfidence,
    };
  }) : [];
  const categories = Array.isArray(data.categories) ? data.categories.map((entry) => {
    const item = object(entry);
    return {
      categoryId: requiredString(item.categoryId),
      label: requiredString(item.label),
    };
  }) : [];
  return {
    itemId,
    suggestions,
    categories,
    needsNewCategory: data.needsNewCategory === true,
    reused: data.reused === true,
  };
}

function parseApplied(value: unknown): AppliedItemCategory {
  const data = object(value);
  const type = data.type;
  if (type !== 'classified' && type !== 'existing_item') throw new Error('ITEM_CATEGORY_APPLY_INVALID');
  return {
    type,
    itemId: requiredString(data.itemId),
    categoryId: requiredString(data.categoryId),
  };
}

const db = supabase as unknown as SupabaseClient;

class ItemCategoryAiService {
  async suggest(itemId: string): Promise<ItemCategorySuggestions> {
    const { data, error } = await supabase.functions.invoke('suggest-item-categories', {
      body: { itemId },
    });
    if (error) throw error;
    return parseSuggestions(data);
  }

  async apply(itemId: string, categoryId: string): Promise<AppliedItemCategory> {
    const { data, error } = await db.rpc('classify_pending_item', {
      p_item_id: itemId,
      p_category_id: categoryId,
    });
    if (error) throw error;
    return parseApplied(data);
  }
}

export const itemCategoryAiService = new ItemCategoryAiService();
