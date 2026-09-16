# Shared product registration

OnePick treats products as shared master data. Users choose an existing product whenever possible. A missing product can be submitted by a user, but it is not selectable as a Pick until an administrator approves it.

## Product ownership policy

- **MVP official products:** administrators create and maintain them directly.
- **Existing product:** the user selects it and writes a one-line Pick review immediately.
- **Missing product:** the user submits the product name and optional representative image. The product is stored with `status = pending`.
- **Pending product:** cannot be used for a Pick.
- **Admin review:** the administrator can approve it as a new product, merge it into an existing product, or reject it.
- **Approved product:** becomes `active` and can then be selected by any user.
- **Duplicate request:** the server reuses a matching active/discontinued product or the caller's own pending request. Another user's pending request is private and is not returned by the submission RPC.

The product carries its category. After a user selects a product, the app should derive category information from the product instead of asking the user to enter it again. Category hierarchy is stored with `categories.parent_id`, so a product assigned to `라면` can be displayed as `먹을것 > 라면`.

## Identity rules

| Category | Same product | Separate products |
| --- | --- | --- |
| Ramen | Bag/cup, package size and quantity | Taste or product line |
| Beer / soju | Can/bottle, volume and quantity | Product line, nonalcoholic variant |
| Snacks | Package weight and quantity | Taste or product line |

Canonicalization reduces simple duplicates, but it is not semantic alias resolution. Brand prefixes, misspellings and alternative names can still require administrator moderation. The Admin review screen therefore shows likely existing products before a pending request is approved.

## Product states

`products.status` supports:

- `pending` — user submission awaiting review
- `active` — official selectable product
- `discontinued` — existing historical/selectable product kept for continuity
- `hidden` — not publicly exposed
- `merged` — duplicate linked to `merged_into_product_id`
- `rejected` — rejected user submission

A regular user cannot directly create an `active` product or change product/category master data. RLS enforces this even if the mobile UI is bypassed.

## Admin workflow

The protected `/admin` route is backed by a private administrator allowlist. Admin permissions are not stored in user-editable profile metadata.

The MVP Admin dashboard provides:

1. **Pending product review**
   - requester username
   - category
   - likely duplicate products
   - approve as a new official product
   - merge into an existing product
   - reject
2. **Official product creation**
   - product name
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
Search product
  ↓
Existing product found ──→ Select product ──→ Write one-line reason ──→ Pick
  ↓ no result
Submit missing product
  ↓
products.status = pending
  ↓
Admin review
  ├─ Approve ─→ active ─→ user can select it as a Pick
  ├─ Merge ───→ merged_into_product_id
  └─ Reject ──→ rejected
```

A user submitting a missing product does **not** need to write a Pick review yet. The review is requested after the product has been approved and the user actually selects it as their OnePick.

## Images

- Existing product images are reused; picking a product does not overwrite its shared image.
- A missing-product submission may include an optional image.
- Imported images are previewed before submission. A public URL does not itself confer reuse permission.
- JPEG/PNG imports have download and pixel limits and an HTTPS manufacturer-host allowlist.
- Local/imported photos are converted to optimized JPEG representative and thumbnail files before upload.
- Only optimized files are uploaded; original/base64 image data is not stored in product rows.
- Pending products protect their referenced image objects while awaiting moderation.
- Storage ownership and rate limits remain enforced independently of product approval.

## Server enforcement

The approval model is enforced in PostgreSQL, not only in the UI:

- `public.submit_product(...)` creates or reuses a product request and inserts new rows as `pending` only.
- `public.register_pick(...)` requires a non-null existing product ID and accepts only `active` or `discontinued` products.
- regular authenticated users cannot insert `active` products through the table API.
- regular authenticated users cannot modify category/brand/product master data.
- administrator writes are authorized through `private.admin_users` and `private.is_admin(...)`.
- `public.current_user_is_admin()` exposes only the boolean access check needed by the app.

Relevant hosted migrations on `onepick-dev`:

- `20260916221838 add_shared_product_registration`
- `20260916222321 add_admin_product_workflow`
- `20260916222614 enforce_pending_product_approval`
- `20260916224617 validate_admin_categories`

## Categories managed in Admin

Open **My profile → 관리자 데이터 관리 → 카테고리**. New categories start as private drafts. To offer a category in the app, set its state to open, make it visible, and allow picking. No application release or slug allowlist change is required.

The hierarchy has at most two levels, for example `먹을것 > 라면`. A parent containing children cannot be pickable. Both the leaf and its parent must be open and visible. The app uses the same category repository for Home, Explore and registration; edits invalidate their query caches. Server triggers reject cycles, third-level categories and picks under a hidden or paused parent. Existing category slugs are stable; their display names can change.

Known ramen/beer/soju/snack slugs still have the agreed packaging normalization rules. Newly created categories preserve their product names until a category-specific rule is deliberately added.

The product finder keeps the entered search name when opening a missing-product request. Selecting a formal product derives its category automatically. The profile's product-request list shows up to 20 recent submissions, with links to approved or merged products. Admin lists show up to 500 products and separately load the oldest 500 pending requests, so newer formal products cannot displace pending requests from the review queue.

The user-facing table INSERT policy for pending products has been removed: all ordinary submissions must pass the RPC's photo, quota and normalization checks. Administrator membership and the quota table have RLS with no client policies by design.

## Validation

The hosted database smoke test verifies:

- normal users submit `pending` products,
- normal users cannot create `active` products,
- normal users cannot modify categories,
- pending products cannot be picked,
- an administrator can approve a pending product,
- approved products can be shared by multiple users through one `product_id`.

The pgTAP shared-product regression test follows the same approval lifecycle. Mobile CI typechecks the Screen → Hook → Service → Repository → Supabase implementation.

## Security notes

The administrator allowlist lives in the private schema and is not readable by `anon` or `authenticated`. Authorization does not rely on user-editable metadata.

The latest security advisor output contains two pre-existing notices unrelated to the Admin RLS boundary: a private image-import quota table with RLS and no client policies, and leaked-password protection disabled in Auth settings. The private quota table is intentionally inaccessible to clients.

