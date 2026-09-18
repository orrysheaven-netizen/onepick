# Book catalog MVP

Status: source/CI preparation only. Do not deploy until the National Library of Korea Open API key is approved and stored as the server-side Supabase secret `NLK_OPEN_API_KEY`.

## Scope
- Category: 콘텐츠 → 책.
- Selectable unit: one ISBN-13 edition/format, not an abstract work.
- Search: title plus optional author.
- Identity: `external_source='nlk_isbn'` + normalized valid ISBN-13.
- Same ISBN is reused. Different ISBNs are never merged merely because title/author match.
- Imported fields: title, author, publisher, publication year and ISBN identity. Edition/form/e-book flags are shown in provider search results but not needed for the shared item card.
- Search never writes item rows. Only a user-selected ISBN is imported; import alone never creates a Pick.
- The normal /pick/choose flow collects the user's own one-line reason and saves the Pick.

## Provider
Official endpoint: `https://www.nl.go.kr/seoji/SearchApi.do`.
Required server parameter: `cert_key`; response mode is JSON. Search sends the official `title` and `author` fields. Import re-fetches the exact `isbn` before writing.

The API key must never be exposed through Expo public variables or client URLs. The Edge Function reads `NLK_OPEN_API_KEY` only.

## Covers and copyrighted fields
The provider documents `TITLE_URL`, book introduction, contents and summary fields. OnePick deliberately ignores all of them in this MVP. The National Library copyright policy requires checking whether a work is actually released for free use; API presence alone is not treated as a blanket image/content license. Book covers therefore remain user-contributed until a reusable rights rule is verified.

## Release gate
Before deployment:
1. Get the National Library Open API key approved.
2. Store it as Supabase secret `NLK_OPEN_API_KEY`; do not paste it into source or chat.
3. Verify real Korean samples (title-only, title+author, multiple editions, e-book/print, older books).
4. Confirm response JSON shape against the live API and measure latency/errors.
5. Re-run TypeScript, full regression suite, web export, DB tests and Edge Function checks.
6. Deploy migration + book-catalog function + app together.
