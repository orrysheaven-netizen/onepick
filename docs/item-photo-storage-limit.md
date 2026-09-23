# Item photo Storage size limit

`item-photos` has a per-object limit of **5 MiB (5,242,880 bytes)**, matching
`supabase/config.toml`. The migration applies this to existing hosted buckets.
Uploads above this size are rejected by Storage, including clients that bypass
the app's image preparation. Full images and thumbnails each have this limit.

The app still resizes full images to a maximum side of 1,200 px and thumbnails
to 320 px, encoding JPEG at quality 0.82. External image import accepts up to
2 MiB before preparation. Historical 768 KiB / 96 KiB RPC caps remain removed.
This supersedes earlier guidance to leave the bucket limit disabled or rely
only on the project-wide limit. Existing objects are not removed or rewritten.

After deployment, verify:

```sql
select id, file_size_limit, public, allowed_mime_types
from storage.buckets where id = 'item-photos';
-- file_size_limit: 5242880; public: true; allowed_mime_types: {image/jpeg}
```
