# Book catalog MVP

Status: Google Books catalog is the active provider.

## Scope
- Category: 책.
- Search UI keeps title + optional author fields, while the client sends one combined `query` to the Edge Function.
- Provider identity: `external_source='google_books_volume'` + Google Books volume ID.
- ISBN is stored as `model_code` when available and is used as a secondary deduplication key.
- Search never writes item rows. Only a user-selected volume is imported; import alone never creates a Pick.
- The normal `/pick/choose` flow collects the user's one-line reason and saves the Pick.

## Provider
Official endpoint: `https://www.googleapis.com/books/v1/volumes`.

Search uses:
- `q=<title + optional author>`
- `printType=books`
- `orderBy=relevance`
- `projection=full`
- `maxResults=20`

`GOOGLE_BOOKS_API_KEY` is optional and, when configured, is read only inside the Edge Function.

## Images and links
- Google Books cover URLs are accepted only from Google Books / Google-hosted image domains and normalized to HTTPS.
- Google Books info links are accepted only from Google Books domains and normalized to HTTPS.
- OnePick stores the provider cover URL as `image_source_url` when a user imports a selected book.

## Contract
The deployed Edge Function and the app must agree on:
- search request: `{ action: 'search', query }`
- import request: `{ action: 'import', externalId }`
- result source: `google_books_volume`
- result identifier: Google Books volume ID, not ISBN

A mismatch here causes valid search results to be filtered out by the client.

## Release checks
1. Search Korean titles such as `아리랑` and `소년이 온다`.
2. Search title + author combinations.
3. Confirm covers render when Google Books provides them.
4. Confirm anonymous search works and authenticated import works.
5. Confirm login return preserves Google Books volume IDs.
6. Run the book catalog regression test and the full app test suite.
