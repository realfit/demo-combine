// Supabase Edge Function: send-registration-confirm
// POST { name, email, athleteId, eventId }
// → sends athlete their confirmation email with ID + QR code
//
// Environment variables (auto-provided or set in Supabase Dashboard → Secrets):
//   RESEND_API_KEY  — your Resend API key

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL     = 'REALFIT Demo <demo@mail.realfit.com>'
const DEMO_SITE_URL  = 'https://demo.scoremycombine.com'

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin':  origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  }
}

function emailHtml(name: string, athleteId: string, eventId: string): string {
  const confirmUrl   = `${DEMO_SITE_URL}/confirm.html?id=${athleteId}&event=${eventId}`
  const scoreboardUrl = `${DEMO_SITE_URL}/scoreboard.html?event=${eventId}`
  const officialUrl  = `${DEMO_SITE_URL}/official.html?event=${eventId}`

  // QR image via quickchart.io — encodes the athlete URL the scanner reads
  const qrData       = encodeURIComponent(`${DEMO_SITE_URL}/athlete?id=${athleteId}`)
  const qrUrl        = `https://quickchart.io/qr?text=${qrData}&size=200&margin=2`

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#111;padding:28px 32px;">
      <div style="font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:-.5px;">REALFIT</div>
      <div style="color:#aaa;font-size:.85rem;margin-top:4px;">ScoreMyCombine — Athlete Registration</div>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:1rem;color:#111;">Hi ${name},</p>
      <p style="margin:0 0 24px;color:#444;line-height:1.6;">
        You're registered as an athlete. Now for the fun part — <strong>step into the official's role and enter your own results.</strong>
      </p>

      <!-- Next step CTA -->
      <div style="margin-bottom:28px;">
        <a href="${officialUrl}"
           style="display:block;text-align:center;background:#111;color:#fff;text-decoration:none;padding:16px;border-radius:8px;font-weight:700;font-size:1rem;">
          Enter Your Results as Official →
        </a>
        <div style="font-size:.78rem;color:#888;text-align:center;margin-top:8px;">Use your demo code to log in, then scan your QR code below</div>
      </div>

      <!-- Athlete ID -->
      <div style="background:#f0f0f0;border-radius:8px;padding:20px 24px;text-align:center;margin-bottom:20px;">
        <div style="font-size:.75rem;font-weight:600;color:#666;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Your Athlete ID</div>
        <div style="font-size:2rem;font-weight:800;letter-spacing:.15em;color:#111;font-variant-numeric:tabular-nums;">${athleteId}</div>
      </div>

      <!-- QR Code -->
      <div style="text-align:center;margin-bottom:28px;">
        <div style="font-size:.75rem;font-weight:600;color:#666;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;">Your QR Code</div>
        <img src="${qrUrl}" alt="Athlete QR code for ${athleteId}"
             width="200" height="200"
             style="border-radius:8px;border:1px solid #e5e7eb;">
        <div style="font-size:.75rem;color:#888;margin-top:8px;">The official view will scan this to load your profile</div>
      </div>

      <!-- Secondary links -->
      <div style="margin-bottom:28px;display:flex;gap:8px;">
        <a href="${scoreboardUrl}"
           style="flex:1;display:block;text-align:center;background:#f3f4f6;color:#374151;text-decoration:none;padding:12px;border-radius:8px;font-size:.875rem;">
          Live Scoreboard
        </a>
        <a href="${confirmUrl}"
           style="flex:1;display:block;text-align:center;background:#f3f4f6;color:#374151;text-decoration:none;padding:12px;border-radius:8px;font-size:.875rem;">
          View Registration
        </a>
      </div>

      <div style="border-top:1px solid #eee;padding-top:20px;font-size:.8rem;color:#999;line-height:1.6;">
        Questions? Reply to this email or reach us at
        <a href="mailto:demo@realfit.com" style="color:#2563eb;">demo@realfit.com</a>
      </div>
    </div>
  </div>
</body>
</html>`
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

  let body: { name?: string; email?: string; athleteId?: string; eventId?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const { name, email, athleteId, eventId } = body
  if (!name?.trim() || !email?.trim() || !athleteId?.trim() || !eventId?.trim()) {
    return new Response(JSON.stringify({ error: 'name, email, athleteId, and eventId are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [email.trim()],
      subject: `You're registered — Athlete ID ${athleteId}`,
      html:    emailHtml(name.trim(), athleteId.trim(), eventId.trim()),
    }),
  })

  if (!emailRes.ok) {
    const emailErr = await emailRes.text()
    console.error('Resend error:', emailErr)
    return new Response(JSON.stringify({ ok: false, error: 'Email delivery failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...cors(origin) }
  })
})
