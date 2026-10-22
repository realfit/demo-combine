// Supabase Edge Function: contact-form
// POST { name, organization, email, message }
// → writes to contact_submissions table + sends notification email to combines@realfit.com
//
// Environment variables (set in Supabase Dashboard → Secrets):
//   SUPABASE_URL              — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY — auto-provided
//   RESEND_API_KEY            — same key used by send-registration-confirm

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY')!

const FROM_EMAIL  = 'REALFIT Website <noreply@mail.realfit.com>'
const NOTIFY_TO   = 'combines@realfit.com'

function cors(_origin: string | null) {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  }
}

function notifyHtml(name: string, org: string, email: string, message: string): string {
  const orgLine = org ? `<tr><td style="color:#6b7280;padding:6px 0;font-size:.85rem;">Organization</td><td style="padding:6px 0;font-size:.9rem;">${org}</td></tr>` : ''
  const msgLine = message ? `<div style="background:#f3f4f6;border-radius:6px;padding:16px;margin-top:16px;font-size:.9rem;line-height:1.6;color:#374151;">${message.replace(/\n/g, '<br>')}</div>` : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#111;padding:24px 32px;">
      <div style="font-size:1.1rem;font-weight:800;color:#fff;letter-spacing:-.5px;">REALFIT</div>
      <div style="color:#aaa;font-size:.8rem;margin-top:2px;">New combine inquiry — scoremycombine.com</div>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#6b7280;padding:6px 0;font-size:.85rem;width:110px;">Name</td><td style="padding:6px 0;font-size:.9rem;font-weight:600;">${name}</td></tr>
        ${orgLine}
        <tr><td style="color:#6b7280;padding:6px 0;font-size:.85rem;">Email</td><td style="padding:6px 0;font-size:.9rem;"><a href="mailto:${email}" style="color:#2563eb;">${email}</a></td></tr>
      </table>
      ${msgLine}
      <div style="margin-top:24px;">
        <a href="mailto:${email}?subject=Re: Your combine inquiry" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:.875rem;font-weight:600;">Reply to ${name} →</a>
      </div>
      <div style="border-top:1px solid #eee;margin-top:24px;padding-top:16px;font-size:.75rem;color:#9ca3af;">
        Submitted via scoremycombine.com · ${new Date().toUTCString()}
      </div>
    </div>
  </div>
</body>
</html>`
}

function confirmHtml(name: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#111;padding:28px 32px;">
      <div style="font-size:1.4rem;font-weight:800;color:#fff;letter-spacing:-.5px;">REALFIT</div>
      <div style="color:#aaa;font-size:.85rem;margin-top:4px;">ScoreMyCombine</div>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:1rem;color:#111;">Hi ${name},</p>
      <p style="margin:0 0 24px;color:#444;line-height:1.6;">
        Thanks for reaching out. We received your message and will be in touch promptly.
      </p>
      <p style="margin:0 0 24px;color:#444;line-height:1.6;">
        In the meantime, you're welcome to try the REALFIT demo combine — the full athlete, official, and scoreboard experience in under five minutes.
      </p>
      <a href="https://demo.scoremycombine.com"
         style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:700;font-size:.95rem;">
        Try the Demo →
      </a>
      <div style="border-top:1px solid #eee;padding-top:20px;margin-top:32px;font-size:.8rem;color:#999;line-height:1.6;">
        Questions? Reply to this email or reach us at
        <a href="mailto:combines@realfit.com" style="color:#2563eb;">combines@realfit.com</a>
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

  let body: { name?: string; organization?: string; email?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  const { name, organization = '', email, message = '' } = body

  if (!name?.trim() || !email?.trim()) {
    return new Response(JSON.stringify({ error: 'name and email are required' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...cors(origin) }
    })
  }

  // 1. Write to Supabase for our records
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const { error: dbError } = await supabase
    .from('contact_submissions')
    .insert({
      name:         name.trim(),
      organization: organization.trim(),
      email:        email.trim(),
      message:      message.trim(),
      source:       'scoremycombine.com',
    })

  if (dbError) {
    console.error('DB insert error:', dbError)
    // Don't block the submission — still try to send the email
  }

  // 2. Send notification email to combines@realfit.com
  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:       FROM_EMAIL,
      to:         [NOTIFY_TO],
      reply_to:   email.trim(),
      subject:    `Combine inquiry from ${name.trim()}${organization.trim() ? ` · ${organization.trim()}` : ''}`,
      html:       notifyHtml(name.trim(), organization.trim(), email.trim(), message.trim()),
    }),
  })

  if (!emailRes.ok) {
    const emailErr = await emailRes.text()
    console.error('Resend error:', emailErr)
  }

  // 3. Send confirmation email to the submitter
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    FROM_EMAIL,
      to:      [email.trim()],
      subject: 'We received your message — REALFIT',
      html:    confirmHtml(name.trim()),
    }),
  })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...cors(origin) }
  })
})
