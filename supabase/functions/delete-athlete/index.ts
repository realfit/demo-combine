// Supabase Edge Function: delete-athlete
// POST { uuid, athleteId }
// → deletes dc_results by athlete_id, then dc_athletes by id
// Uses service role key — never expose this in client-side code

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  let body: { uuid?: string; athleteId?: string }
  try { body = await req.json() }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const { uuid, athleteId } = body
  if (!uuid?.trim() || !athleteId?.trim()) {
    return new Response(JSON.stringify({ error: 'uuid and athleteId are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const { error: resErr, count: resCount } = await sb
    .from('dc_results')
    .delete({ count: 'exact' })
    .eq('athlete_id', athleteId)

  if (resErr) {
    console.error('results delete error:', resErr)
    return new Response(JSON.stringify({ error: 'Failed to delete results: ' + resErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const { error: athErr, count: athCount } = await sb
    .from('dc_athletes')
    .delete({ count: 'exact' })
    .eq('id', uuid)

  if (athErr) {
    console.error('athlete delete error:', athErr)
    return new Response(JSON.stringify({ error: 'Failed to delete athlete: ' + athErr.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  console.log(`Deleted athlete ${athleteId} (${uuid}): ${resCount} results, ${athCount} athlete rows`)
  return new Response(JSON.stringify({ ok: true, resultsDeleted: resCount, athleteDeleted: athCount }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...cors(origin) }
  })
})
