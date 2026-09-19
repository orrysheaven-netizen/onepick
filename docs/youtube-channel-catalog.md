# YouTube channel catalog MVP

Status: source/CI preparation only. Do not deploy until Google Cloud credentials, quota, policy review and live refresh/cleanup verification are complete.

## Product scope
- Category: 콘텐츠 → 유튜브.
- Selectable unit: one YouTube channel.
- Public search accepts channel name, @handle, a /channel/ URL or a channel ID.
- @handle / channel-ID lookup uses channels.list. General name search uses search.list with type=channel, safeSearch=strict and Korean relevance language.
- Search never creates OnePick item rows. A signed-in user must explicitly select a channel before it is imported, then the existing /pick/choose flow collects the user's own one-line reason.
- No subscriber counts, views, video counts, rankings or derived YouTube metrics are requested or stored.

## Credentials and quota
Create a Google Cloud project, enable YouTube Data API v3 and create an API key restricted to the YouTube Data API. Store it only as the Supabase Edge Function secret `YOUTUBE_API_KEY`.

Current official documentation (checked 2026-09-18) describes:
- channels.list: 1 quota unit per call.
- search.list: a separate default bucket of 100 calls/day, 1 unit per call.
- Every API request consumes quota.

Because generic name search has a low default daily bucket, OnePick:
- prefers direct @handle/channel URL lookup when possible,
- debounces client search by 300 ms,
- reuses exact client results for 10 minutes,
- reuses server results for 10 minutes,
- limits provider results to 10.
Scale beyond pilot requires a YouTube quota/compliance review.

## Storage, refresh and deletion
YouTube's Developer Policies require Non-Authorized API Data to be deleted or refreshed within 30 calendar days. OnePick uses a 25-day safety window.

The migration:
- adds `items.external_refreshed_at`,
- installs Supabase Cron / pg_cron,
- schedules `private.scrub_stale_youtube_api_data()` daily,
- strips stale YouTube API-derived title/URL/thumbnail/external mapping,
- retains the internal item/pick relationship as a neutral discontinued tombstone,
- deletes stale YouTube search cache rows.

Selected channels are revalidated on import when older than 20 days. A fresh provider search also refreshes matching existing item metadata. Thumbnail URLs are used exactly as returned over HTTPS; image binaries are not copied into OnePick Storage.

## User notice / consent
The YouTube search screen is gated behind an explicit local consent acknowledgement. The app includes always-accessible draft policy pages and links to:
- YouTube Terms of Service: https://www.youtube.com/t/terms
- Google Privacy Policy: https://policies.google.com/privacy

This is an MVP policy implementation, not a substitute for the operator's legal review. Before public launch, confirm that OnePick's persistent social use case and presentation of YouTube channel metadata alongside OnePick user-generated Picks/reviews satisfies the current YouTube API Services Terms and Developer Policies. If uncertain, submit an API Compliance Audit.

## Release gate
1. Enable YouTube Data API v3 in Google Cloud.
2. Create a server-side API key restricted to YouTube Data API v3.
3. Save it as Supabase secret `YOUTUBE_API_KEY`; never put it in Expo public env vars, URLs or chat.
4. Review/approve the privacy and terms drafts.
5. Verify the pg_cron cleanup job actually runs in the target Supabase project.
6. Verify real Korean/English channel name search and @handle lookup.
7. Verify import, login-return, 20-day refresh, 25-day scrub and deleted/unavailable channel behavior.
8. Check current quota and complete a YouTube API Compliance Audit/quota extension if required.
9. Only then deploy migration + youtube-catalog Edge Function + app together.
