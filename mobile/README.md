# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Validation

Copy `.env.example` to `.env.local` and set the project's public Supabase key before running the app. Never use a service-role key in the mobile client.

Kakao login requests only `profile_nickname` via `options.queryParams.scope`. The `scopes` option is additive for Supabase's Kakao provider and would still request email and a profile photo. In Kakao Developers, enable nickname as optional consent; leave email and profile image disabled. In Supabase's Kakao provider settings, enable **Allow users without an email**. Add the development/production callback URLs to Supabase's redirect allow list and its Auth callback URL to Kakao's Redirect URI list.

Web uses browser local storage; native builds use AES-GCM encrypted AsyncStorage with the encryption key in Expo SecureStore. Static web rendering uses Supabase's in-memory fallback. Public environment variables must use static `process.env.EXPO_PUBLIC_…` access so Expo can include them in the client bundle.

## Native test builds

See [iOS/Android build readiness](../docs/native-build-readiness.md) for the tested baseline, account-owned identifiers, EAS preview profiles, OAuth/deep-link setup and device acceptance checklist. `npm run check:native -- --platform android` (or `ios`) checks the supplied configuration without starting a build. Native account values may remain unset for ordinary web/PWA work.

Run these checks from the `mobile` directory:

```bash
npm run typecheck
npm test
```

Mobile CI runs both commands after `npm ci` using Node.js 22.13.1. The test runner discovers every `scripts/test-*.cjs` file and fails if any check fails.

The checks cover home personalization, pick management, item search, auth session recovery/logout, returning to the intended screen after login, item/category eligibility, comment submission failure/retry, and Expo runtime configuration. They use repository/auth substitutes and rendered components; real Kakao authentication and device behavior still need separate verification.

## Movie catalog

Movie search uses the `movie-catalog` Supabase Edge Function. Store the TMDB API Read Access Token as the server-side `TMDB_READ_ACCESS_TOKEN` Edge Function secret; never add it to `EXPO_PUBLIC_…` variables. The app searches TMDB only inside `콘텐츠 › 영화` and saves a movie to `items` only after the user selects it. See `docs/movie-catalog.md` from the repository root for the data and security rules.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
