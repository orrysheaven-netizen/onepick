# MVP demo data

OnePick's early test environment uses five clearly identified synthetic profiles only for UI and flow validation.

- `demo_01` … `demo_05`
- They are not real users.
- They have no `auth.identities` or `auth.sessions` rows and cannot be used as ordinary login accounts.
- UI/share surfaces label them as DEMO.
- Admin operations metrics and product-funnel analytics exclude `demo_%`.
- The admin OnePick dashboard (`admin_onepick_dashboard()`) excludes demo accounts and admin-allowlisted accounts from every user-activity metric.
- Demo detection (`private.is_demo_profile(uuid)`) does not rely on the username: it matches the fixed seed ids (`d0e00001-…` to `d0e00005-…`), the `auth.users.raw_app_meta_data.demo = true` marker that `demo_seed.sql` sets, or a `demo_` username prefix. Renaming a seed profile does not turn its activity into real numbers.
- Alcohol categories are not used in the demo seed.

The normal `supabase/seed.sql` does **not** create these profiles. To reproduce the current MVP demo state in a test environment, run `supabase/demo_seed.sql` manually. To remove the five synthetic profiles and their dependent Picks, run `supabase/demo_cleanup.sql`.

The cleanup intentionally retains shared catalog items such as Interstellar, Misaeng, Minecraft and Pokémon entries because those are ordinary catalog records rather than synthetic user content.

Current demo coverage includes ramen, movie, drama, music, YouTube, game, Pokémon and snacks, with differing selections so Home/Profile/share flows show more than one taste pattern.
