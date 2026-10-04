import { withSupabase } from '@supabase/server';

const ITEM_BUCKET = 'item-photos';
const PROFILE_IMAGE_BUCKET = 'profile-images';
const DELETE_REQUEST_STATUSES = ['pending', 'rejected', 'merged'];

function jsonError(code: string, status = 500) {
  return Response.json({ ok: false, code }, { status });
}

async function preserveItemAsset(
  admin: any,
  userId: string,
  itemId: string,
  sourcePath: string | null,
  kind: 'image' | 'thumb',
) {
  if (!sourcePath || !sourcePath.startsWith(`${userId}/`)) return sourcePath;

  const { data: blob, error: downloadError } = await admin.storage
    .from(ITEM_BUCKET)
    .download(sourcePath);
  if (downloadError || !blob) throw new Error('ACCOUNT_ASSET_READ_FAILED');

  const destination = kind === 'image'
    ? `catalog/${itemId}.jpg`
    : `catalog/${itemId}-thumb.jpg`;
  const { error: uploadError } = await admin.storage
    .from(ITEM_BUCKET)
    .upload(destination, blob, {
      upsert: true,
      cacheControl: '31536000',
      contentType: blob.type || 'image/jpeg',
    });
  if (uploadError) throw new Error('ACCOUNT_ASSET_PRESERVE_FAILED');

  return destination;
}

async function removeUserFolder(admin: any, userId: string, bucket = ITEM_BUCKET) {
  for (;;) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(userId, { limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error('ACCOUNT_ASSET_LIST_FAILED');
    if (!data?.length) return;

    const paths = data
      .filter((item: { name?: string }) => Boolean(item.name))
      .map((item: { name: string }) => `${userId}/${item.name}`);
    if (!paths.length) return;

    const { error: removeError } = await admin.storage.from(bucket).remove(paths);
    if (removeError) throw new Error('ACCOUNT_ASSET_DELETE_FAILED');
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const userId = ctx.userClaims?.id;
    if (!userId) return jsonError('AUTH_REQUIRED', 401);

    try {
      const { error: discardError } = await ctx.supabaseAdmin
        .from('items')
        .delete()
        .eq('created_by', userId)
        .in('status', DELETE_REQUEST_STATUSES);
      if (discardError) throw new Error('ACCOUNT_ITEM_REQUEST_CLEANUP_FAILED');

      const userPrefix = `${userId}/%`;
      const { data: referencedItems, error: itemError } = await ctx.supabaseAdmin
        .from('items')
        .select('id,image_path,thumbnail_path')
        .or(`image_path.like.${userPrefix},thumbnail_path.like.${userPrefix}`);
      if (itemError) throw new Error('ACCOUNT_ITEM_ASSET_LOOKUP_FAILED');

      for (const item of referencedItems ?? []) {
        const imagePath = await preserveItemAsset(
          ctx.supabaseAdmin,
          userId,
          item.id,
          item.image_path,
          'image',
        );
        const thumbnailPath = await preserveItemAsset(
          ctx.supabaseAdmin,
          userId,
          item.id,
          item.thumbnail_path,
          'thumb',
        );

        if (imagePath !== item.image_path || thumbnailPath !== item.thumbnail_path) {
          const { error: updateError } = await ctx.supabaseAdmin
            .from('items')
            .update({ image_path: imagePath, thumbnail_path: thumbnailPath })
            .eq('id', item.id);
          if (updateError) throw new Error('ACCOUNT_ITEM_ASSET_UPDATE_FAILED');
        }
      }

      await removeUserFolder(ctx.supabaseAdmin, userId);
      // Profile photos are personal; none are preserved for the service.
      await removeUserFolder(ctx.supabaseAdmin, userId, PROFILE_IMAGE_BUCKET);

      const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteError) throw new Error('ACCOUNT_AUTH_DELETE_FAILED');

      return Response.json({ ok: true });
    } catch (error) {
      console.error('delete-account failed', error);
      return jsonError(error instanceof Error ? error.message : 'ACCOUNT_DELETE_FAILED');
    }
  }),
};
