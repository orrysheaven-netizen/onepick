import { withSupabase } from '@supabase/server';

const PRODUCT_BUCKET = 'product-photos';
const DELETE_REQUEST_STATUSES = ['pending', 'rejected', 'merged'];

function jsonError(code: string, status = 500) {
  return Response.json({ ok: false, code }, { status });
}

async function preserveProductAsset(
  admin: any,
  userId: string,
  productId: string,
  sourcePath: string | null,
  kind: 'image' | 'thumb',
) {
  if (!sourcePath || !sourcePath.startsWith(`${userId}/`)) return sourcePath;

  const { data: blob, error: downloadError } = await admin.storage
    .from(PRODUCT_BUCKET)
    .download(sourcePath);
  if (downloadError || !blob) throw new Error('ACCOUNT_ASSET_READ_FAILED');

  const destination = kind === 'image'
    ? `catalog/${productId}.jpg`
    : `catalog/${productId}-thumb.jpg`;
  const { error: uploadError } = await admin.storage
    .from(PRODUCT_BUCKET)
    .upload(destination, blob, {
      upsert: true,
      cacheControl: '31536000',
      contentType: blob.type || 'image/jpeg',
    });
  if (uploadError) throw new Error('ACCOUNT_ASSET_PRESERVE_FAILED');

  return destination;
}

async function removeUserFolder(admin: any, userId: string) {
  for (;;) {
    const { data, error } = await admin.storage
      .from(PRODUCT_BUCKET)
      .list(userId, { limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error('ACCOUNT_ASSET_LIST_FAILED');
    if (!data?.length) return;

    const paths = data
      .filter((item: { name?: string }) => Boolean(item.name))
      .map((item: { name: string }) => `${userId}/${item.name}`);
    if (!paths.length) return;

    const { error: removeError } = await admin.storage.from(PRODUCT_BUCKET).remove(paths);
    if (removeError) throw new Error('ACCOUNT_ASSET_DELETE_FAILED');
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const userId = ctx.userClaims?.id;
    if (!userId) return jsonError('AUTH_REQUIRED', 401);

    try {
      const { error: discardError } = await ctx.supabaseAdmin
        .from('products')
        .delete()
        .eq('created_by', userId)
        .in('status', DELETE_REQUEST_STATUSES);
      if (discardError) throw new Error('ACCOUNT_PRODUCT_REQUEST_CLEANUP_FAILED');

      const userPrefix = `${userId}/%`;
      const { data: referencedProducts, error: productError } = await ctx.supabaseAdmin
        .from('products')
        .select('id,image_path,thumbnail_path')
        .or(`image_path.like.${userPrefix},thumbnail_path.like.${userPrefix}`);
      if (productError) throw new Error('ACCOUNT_PRODUCT_ASSET_LOOKUP_FAILED');

      for (const product of referencedProducts ?? []) {
        const imagePath = await preserveProductAsset(
          ctx.supabaseAdmin,
          userId,
          product.id,
          product.image_path,
          'image',
        );
        const thumbnailPath = await preserveProductAsset(
          ctx.supabaseAdmin,
          userId,
          product.id,
          product.thumbnail_path,
          'thumb',
        );

        if (imagePath !== product.image_path || thumbnailPath !== product.thumbnail_path) {
          const { error: updateError } = await ctx.supabaseAdmin
            .from('products')
            .update({ image_path: imagePath, thumbnail_path: thumbnailPath })
            .eq('id', product.id);
          if (updateError) throw new Error('ACCOUNT_PRODUCT_ASSET_UPDATE_FAILED');
        }
      }

      await removeUserFolder(ctx.supabaseAdmin, userId);

      const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(userId);
      if (deleteError) throw new Error('ACCOUNT_AUTH_DELETE_FAILED');

      return Response.json({ ok: true });
    } catch (error) {
      console.error('delete-account failed', error);
      return jsonError(error instanceof Error ? error.message : 'ACCOUNT_DELETE_FAILED');
    }
  }),
};
