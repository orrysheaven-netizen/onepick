import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { importImage, readLimited, validateSource } from './imageImport.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,x-client-info,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (body: unknown,status=200) => new Response(JSON.stringify(body),{status,headers});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply({error:'METHOD_NOT_ALLOWED'},405);
  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return reply({error:'AUTH_REQUIRED'},401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
      global:{headers:{Authorization:authorization}}, auth:{persistSession:false,autoRefreshToken:false},
    });
    const {data:{user},error:authError} = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return reply({error:'AUTH_REQUIRED'},401);
    const body = JSON.parse(new TextDecoder().decode(await readLimited(req.body,4096)));
    if (typeof body.url !== 'string') return reply({error:'IMAGE_SOURCE_UNSUPPORTED'},400);
    validateSource(body.url);
    const {error} = await client.rpc('consume_image_import');
    if (error) return reply({error:error.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'FORBIDDEN'},error.message === 'RATE_LIMITED' ? 429 : 403);
    return reply(await importImage(body.url));
  } catch(error) {
    const code = error instanceof Error && ['IMAGE_SOURCE_UNSUPPORTED','PHOTO_INVALID','PHOTO_TOO_LARGE'].includes(error.message) ? error.message : 'IMAGE_IMPORT_FAILED';
    return reply({error:code},400);
  }
});
