import type { Database } from './database.types';

type RegisterPick = Database['public']['Functions']['register_pick'];

// PostgreSQL accepts NULL for this required argument when creating a product.
// Generated RPC types cannot infer parameter nullability; keep this correction
// separate so refreshing database.types.ts never removes it.
export type AppDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Omit<Database['public']['Functions'], 'register_pick'> & {
      register_pick: Omit<RegisterPick, 'Args'> & {
        Args: Omit<RegisterPick['Args'], 'p_product_id'> & {
          p_product_id: string | null;
        };
      };
    };
  };
};
