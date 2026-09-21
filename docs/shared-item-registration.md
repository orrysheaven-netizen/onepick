# Shared item registration

OnePick treats items as shared master data. Users choose an existing item whenever possible. A missing item can be submitted by a user, but it is not selectable as a Pick until an administrator approves it.

## Item ownership policy

- **MVP official items:** administrators create and maintain them directly.
- **Existing item:** the user selects it and writes a one-line Pick review immediately.
- **Missing item:** the user submits the item name and optional representative image. The item is stored with `status = pending`.
- **Pending item:** cannot be used for a Pick.
- **Admin review:** the administrator can approve it as a new item, merge it into an existing item, or reject it.
- **Approved item:** becomes `active` and can then be selected by any user.
- **Duplicate request:** the server reuses a matching active/discontinued item or the caller's own pending request. Another user's pending request is private and is not returned by the submission RPC.

The item carries its category. After a user selects an item, the app should derive category information from the item instead of asking the user to enter it again. Category hierarchy is stored with `categories.parent_id`, so an item assigned to `라면` can be displayed as `먹을것 > 라면`.

## Identity rules

| Category | Same item | Separate items |
| --- | --- | --- |
| Ramen | Bag/cup, package size and quantity | Taste or item line |
| Beer / soju | Can/bottle, volume and quantity | Item line, nonalcoholic variant |
| Snacks | Package weight and quantity | Taste or item line |

Canonicalization reduces simple duplicates, but it is not semantic alias resolution. Brand prefixes, misspellings and alternative names can still require administrator moderation. The Admin review screen therefore shows likely existing items before a pending request is approved.

## Item states

`items.status` supports:

- `pending` — user submission awaiting review
- `active` — official selectable item
- `discontinued` — existing historical/selectable item kept for continuity
- `hidden` — not publicly exposed
- `merged` — duplicate linked to `merged_into_item_id`
- `rejected` — rejected user submission

A regular user cannot directly create an `active` item or change item/category master data. RLS enforces this even if the mobile UI is bypassed.

## Admin workflow

The protected `/admin` route is backed by a private administrator allowlist. Admin permissions are not stored in user-editable profile metadata.

The MVP Admin dashboard provides:

1. **Pending item review**
   - requester username
   - category
   - likely duplicate items
   - approve as a new official item
   - merge into an existing item
   - reject
2. **Official item creation**
   - item name
   - category
   - optional brand
   - optional official URL
3. **Category creation**
   - parent/child hierarchy
   - visibility
   - pickable status
   - edit name, parent, operational status and display order
   - immutable slug for established links and identity rules
4. **Brand creation**

## User submission flow

```text
Search item (no category needed)
  ↓
Existing item found ──→ Select item ──→ Write one-line reason ──→ Pick
  ↓ no result
Submit missing item by name only
  ↓
items.status = pending, category = hidden 'pending-product' staging bucket
  ↓
AI suggests up to three existing categories (suggest-item-categories)
  ├─ User applies one ──────────→ classify_pending_item moves it to that category
  ├─ User picks from the full list → same
  ├─ No category fits ──────────→ user writes a free-text hint
  │                                 (set_pending_item_category_hint → items.requested_category_label)
  └─ User leaves it for later
  ↓
Admin review (데이터 관리 › 검수 대기)
  ├─ Approve ─→ reviewer assigns a real category (required for staged items) ─→ active
  ├─ Merge ───→ merged_into_item_id
  └─ Reject ──→ rejected
```

The free-text hint is advice for the reviewer, never a category row: the taxonomy stays administrator-owned, so a hint like `텀블러` results in either an existing category assignment or a new category created by the administrator before approval. Hints are 1–60 characters, only the requester can write or change one, and only while the request is still `pending`. The hint is kept on the approved item so recurring hints can inform future category additions.

A user submitting a missing item does **not** need to write a Pick review yet. The review is requested after the item has been approved and the user actually selects it as their OnePick.

## Images

- Existing item images are reused; picking an item does not overwrite its shared image.
- A missing-item submission may include an optional image.
- Imported images are previewed before submission. A public URL does not itself confer reuse permission.
- JPEG/PNG imports have download and pixel limits and an HTTPS manufacturer-host allowlist.
- Local/imported photos are converted to optimized JPEG representative and thumbnail files before upload.
- Only optimized files are uploaded; original/base64 image data is not stored in item rows.
- Pending items protect their referenced image objects while awaiting moderation.
- Storage ownership and rate limits remain enforced independently of item approval.

## Server enforcement

The approval model is enforced in PostgreSQL, not only in the UI:

- `public.submit_item(...)` creates or reuses an item request and inserts new rows as `pending` only.
- `public.register_pick(...)` requires a non-null existing item ID and accepts only `active` or `discontinued` items.
- regular authenticated users cannot insert `active` items through the table API.
- regular authenticated users cannot modify category/brand/item master data.
- administrator writes are authorized through `private.admin_users` and `private.is_admin(...)`.
- `public.current_user_is_admin()` exposes only the boolean access check needed by the app.

Relevant hosted migrations on `onepick-dev`:

- `20260916221838 add_shared_item_registration`
- `20260916222321 add_admin_item_workflow`
- `20260916222614 enforce_pending_item_approval`
- `20260916224617 validate_admin_categories`

## Categories managed in Admin

Open **My profile → 관리자 데이터 관리 → 카테고리**. New categories start as private drafts. To offer a category in the app, set its state to open, make it visible, and allow picking. No application release or slug allowlist change is required.

The hierarchy has at most two levels, for example `먹을것 > 라면`. A parent containing children cannot be pickable. Both the leaf and its parent must be open and visible. The app uses the same category repository for Home, Explore and registration; edits invalidate their query caches. Server triggers reject cycles, third-level categories and picks under a hidden or paused parent. Existing category slugs are stable; their display names can change.

Known ramen/beer/soju/snack slugs still have the agreed packaging normalization rules. Newly created categories preserve their item names until a category-specific rule is deliberately added.

The item finder keeps the entered search name when opening a missing-item request. Selecting a formal item derives its category automatically. The request confirmation links directly to My Profile. The profile's item-request list shows up to 20 recent submissions, with links to approved items or public merge targets. Users can refresh the profile to check approval from another administrator session; a failed refresh keeps the last loaded data visible with an error notice. Item detail leads to the existing Pick selection flow. Admin lists show up to 500 items and separately load the oldest 500 pending requests, so newer formal items cannot displace pending requests from the review queue.

The user-facing table INSERT policy for pending items has been removed: all ordinary submissions must pass the RPC's photo, quota and normalization checks. Administrator membership and the quota table have RLS with no client policies by design.

## Validation

The hosted database smoke test verifies:

- normal users submit `pending` items,
- normal users cannot create `active` items,
- normal users cannot modify categories,
- pending items cannot be picked,
- an administrator can approve a pending item,
- approved items can be shared by multiple users through one `item_id`.

The pgTAP shared-item regression test follows the same approval lifecycle. Mobile CI typechecks the Screen → Hook → Service → Repository → Supabase implementation.

## Security notes

The administrator allowlist lives in the private schema and is not readable by `anon` or `authenticated`. Authorization does not rely on user-editable metadata.

The latest security advisor output contains two pre-existing notices unrelated to the Admin RLS boundary: a private image-import quota table with RLS and no client policies, and leaked-password protection disabled in Auth settings. The private quota table is intentionally inaccessible to clients.
