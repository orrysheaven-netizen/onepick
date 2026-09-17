# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example` and set the Supabase client values.

   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
   ```

3. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## OnePick Admin

The admin workspace is available on web under `/admin`.

- `/admin` — dashboard metrics and recent admin audit logs
- `/admin/categories` — category creation and operating settings
- `/admin/items` — item search, status and metadata management
- `/admin/pending` — approve, reject, or merge pending items into existing catalog items
- `/admin/users` — read-only user lookup
- `/admin/reports` — content report review and resolution status
- `/admin/audit` — recent admin audit log history

Admin authentication uses the existing Supabase Kakao provider. After Kakao sign-in, the app calls `current_user_is_admin()` and only allows users present in the server-side admin allowlist.

Before testing Kakao admin login, add every admin web origin to **Supabase Auth > URL Configuration > Redirect URLs** with the `/admin` path. For example, when Expo web runs on port 8081, add `http://localhost:8081/admin`. Add the production `/admin` URL separately when the app is deployed.

Do not put a Supabase secret/service-role key in `EXPO_PUBLIC_*` variables or client code.

The admin list screens intentionally cap a single request at 100 records. Use search/status filters rather than loading the full catalog as the dataset grows.

## Production web build

The project uses Expo Router static web output. Verify a production-ready build with:

```bash
npm run typecheck
npm run build:web
```

The exported website is written to `dist/`. GitHub Actions runs the same checks for admin changes.

A repository-level `vercel.json` is included so Vercel can build the app from the monorepo root. Configure these two environment variables in the hosting project before deployment:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

After the production domain is known, add `https://YOUR_DOMAIN/admin` to Supabase Auth Redirect URLs so Kakao login can return to the admin workspace.
