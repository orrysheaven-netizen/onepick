# OnePick

## Admin web

The admin workspace is available on web under `/admin`.

- `/admin` — dashboard metrics and recent admin audit logs
- `/admin/categories` — category creation and operating settings
- `/admin/items` — item search, status and metadata management
- `/admin/pending` — approve, reject, or merge pending items into existing catalog items
- `/admin/users` — read-only user lookup
- `/admin/reports` — content report review and resolution status
- `/admin/audit` — recent admin audit log history

Admin authentication uses the existing Supabase Kakao provider. After Kakao sign-in, the app calls `current_user_is_admin()` and only allows users present in the server-side admin allowlist.

## Local setup

```bash
npm install
cp .env.example .env
npm run web
```

Required environment variables:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Before testing Kakao admin login, add the local `/admin` URL to Supabase Auth Redirect URLs. For example: `http://localhost:8081/admin`.

## Production build

```bash
npm run typecheck
npm run build:web
```

The static site is exported to `dist/`.

A repository-level `vercel.json` is included. Configure the same two `EXPO_PUBLIC_*` environment variables in the hosting project, then add the production `/admin` URL to Supabase Auth Redirect URLs.

Never expose a Supabase secret/service-role key in client code.
