// Supabase Edge Function: request-demo
// POST { name, email, org }
// → creates a private demo-XXXXXX event slug
// → inserts into dc_demo_codes
// → sends email via Resend with the 6-digit code
//
// Environment variables (set in Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL           — auto-provided by Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase runtime
//   RESEND_API_KEY         — your Resend API key

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM_EMAIL            = 'REALFIT Demo <demo@mail.realfit.com>'
const DEMO_SITE_URL         = 'https://demo.scoremycombine.com'
const DEMO_EXPIRY_HOURS     = 48

// ── helpers ──────────────────────────────────────────────────

function randomCode(): string {
  // 6-digit numeric code: 100000–999999
  return String(Math.floor(100000 + Math.random() * 900000))
}

function randomSlug(): string {
  // demo-XXXXXX  where X is alphanumeric (lowercase)
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `demo-${s}`
}

function expiresAt(): string {
  const d = new Date()
  d.setHours(d.getHours() + DEMO_EXPIRY_HOURS)
  return d.toISOString()
}

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  }
}

// ── email template ────────────────────────────────────────────

function emailHtml(name: string, code: string, eventId: string): string {
  const firstName     = name.split(' ')[0]
  const officialName  = encodeURIComponent(`${name} (Official)`)
  const registerUrl   = `${DEMO_SITE_URL}/register.html?event=${eventId}`
  const officialUrl   = `${DEMO_SITE_URL}/official.html?event=${eventId}&name=${officialName}`
  const scoreboardUrl = `${DEMO_SITE_URL}/scoreboard.html?event=${eventId}`

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#111;padding:28px 32px;">
      <div style="font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:-.5px;">REALFIT</div>
      <div style="color:#aaa;font-size:.85rem;margin-top:4px;">ScoreMyCombine Demo Access</div>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:1rem;color:#111;">Hi ${firstName},</p>
      <p style="margin:0 0 24px;color:#444;line-height:1.6;">
        You're set up with a private demo of ScoreMyCombine. In a real combine, only a certified REALFIT official can enter athlete results. In this demo, <strong>you play both roles</strong> — athlete and official — so you can see the entire scoring process firsthand.
      </p>

      <p style="margin:0 0 12px;font-weight:700;color:#111;">Three clicks to the full experience:</p>
      <table style="width:100%;border-collapse:separate;border-spacing:0 8px;margin-bottom:28px;">
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:2px;color:#888;font-size:.85rem;font-weight:700;">1</td>
          <td><a href="${registerUrl}" style="color:#2563eb;font-weight:600;text-decoration:none;">Register as an athlete →</a><br>
          <span style="font-size:.82rem;color:#666;">Takes 30 seconds — you'll get your QR code by email</span></td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:2px;color:#888;font-size:.85rem;font-weight:700;">2</td>
          <td><a href="${officialUrl}" style="color:#2563eb;font-weight:600;text-decoration:none;">Step into the official role →</a><br>
          <span style="font-size:.82rem;color:#666;">Your name is pre-filled — just scan your QR code and enter your results</span></td>
        </tr>
        <tr>
          <td style="width:28px;vertical-align:top;padding-top:2px;color:#888;font-size:.85rem;font-weight:700;">3</td>
          <td><a href="${scoreboardUrl}" style="color:#2563eb;font-weight:600;text-decoration:none;">See yourself on the live scoreboard →</a><br>
          <span style="font-size:.82rem;color:#666;">Ranked against benchmark athletes in real time</span></td>
        </tr>
      </table>

      <div style="border-top:1px solid #eee;padding-top:20px;font-size:.8rem;color:#999;line-height:1.6;">
        This is a private demo session that expires in ${DEMO_EXPIRY_HOURS} hours.<br><br>
        Questions? Reply to this email or reach us at <a href="mailto:demo@realfit.com" style="color:#2563eb;">demo@realfit.com</a>
      </div>
    </div>
  </div>
</body>
</html>`
}

// ── handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(origin) })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  let body: { name?: string; email?: string; org?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const { name, email, org } = body
  if (!name?.trim() || !email?.trim()) {
    return new Response(JSON.stringify({ error: 'name and email are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // Generate unique code + slug (retry on collision — extremely unlikely)
  let code = randomCode()
  let eventId = randomSlug()
  for (let i = 0; i < 5; i++) {
    const { data } = await sb.from('dc_demo_codes').select('id').eq('code', code).maybeSingle()
    if (!data) break
    code = randomCode()
    eventId = randomSlug()
  }

  const expiry = expiresAt()

  // Create the private event slug in events table
  const { error: evtErr } = await sb.from('events').insert({
    id:          eventId,
    name:        `Demo — ${name.trim()}`,
    description: `Private demo session for ${name.trim()} (${email.trim()})`,
    active:      true,
  })
  if (evtErr) {
    console.error('events insert error:', evtErr)
    return new Response(JSON.stringify({ error: 'Failed to create demo session' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  // Insert demo code row
  const { error: codeErr } = await sb.from('dc_demo_codes').insert({
    code,
    event_id:   eventId,
    email:      email.trim(),
    name:       name.trim(),
    org:        org?.trim() || null,
    expires_at: expiry,
  })
  if (codeErr) {
    console.error('dc_demo_codes insert error:', codeErr)
    // Clean up the event we just created
    await sb.from('events').delete().eq('id', eventId)
    return new Response(JSON.stringify({ error: 'Failed to store demo code' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  // Send email via Resend
  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [email.trim()],
      subject: `Your ScoreMyCombine demo code: ${code}`,
      html:    emailHtml(name.trim(), code, eventId),
    }),
  })

  if (!emailRes.ok) {
    const emailErr = await emailRes.text()
    console.error('Resend error:', emailErr)
    // Don't fail the request — code is in DB, email can be resent from admin
    return new Response(JSON.stringify({ ok: true, warning: 'Email delivery failed — check admin panel' }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...cors(origin) }
  })
})
