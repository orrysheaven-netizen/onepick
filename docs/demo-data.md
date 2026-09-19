# MVP demo data

OnePick's early test environment uses five clearly identified synthetic profiles only for UI and flow validation.

- `demo_01` … `demo_05`
- They are not real users.
- They have no `auth.identities` or `auth.sessions` rows and cannot be used as ordinary login accounts.
- UI/share surfaces label them as DEMO.
- Admin operations metrics and product-funnel analytics exclude `demo_%`.
- Alcohol categories are not used in the demo seed.

The normal `supabase/seed.sql` does **not** create these profiles. To reproduce the current MVP demo state in a test environment, run `supabase/demo_seed.sql` manually. To remove the five synthetic profiles and their dependent Picks, run `supabase/demo_cleanup.sql`.

The cleanup intentionally retains shared catalog items such as Interstellar, Misaeng, Minecraft and Pokémon entries because those are ordinary catalog records rather than synthetic user content.

Current demo coverage includes ramen, movie, drama, music, YouTube, game, Pokémon and snacks, with differing selections so Home/Profile/share flows show more than one taste pattern.
