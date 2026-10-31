import type { Env } from './core';

export type DecisionEmailInput = {
  to: string;
  name: string;
  subject: string;
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
};

export type DeliveryResult = {
  delivered: boolean;
  channel: 'resend' | 'cloudflare_email' | 'unavailable';
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}

function emailHtml(input: DecisionEmailInput): string {
  const title = escapeHtml(input.title);
  const name = escapeHtml(input.name || 'عضو KSA.MEN');
  const message = escapeHtml(input.message).replace(/\n/g, '<br>');
  const actionLabel = escapeHtml(input.actionLabel);
  const actionUrl = escapeHtml(input.actionUrl);
  return `<div dir="rtl" style="margin:0;padding:32px 16px;background:#f4f7f5;color:#163629;font-family:Tahoma,Arial,sans-serif;line-height:1.75"><main style="max-width:620px;margin:0 auto;padding:30px;border:1px solid #d5e0d8;border-radius:22px;background:#ffffff"><p style="margin:0 0 10px;color:#8b6b2b;font-size:12px;font-weight:700;letter-spacing:.08em">KSA.MEN / هوية مهنية</p><h1 style="margin:0 0 18px;color:#004422;font-size:25px;line-height:1.35">${title}</h1><p style="margin:0 0 14px">مرحباً ${name}،</p><p style="margin:0 0 24px">${message}</p><p style="margin:0"><a href="${actionUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#006837;color:#ffffff;text-decoration:none;font-weight:700">${actionLabel}</a></p><p style="margin:26px 0 0;color:#5f7468;font-size:13px">هذه رسالة تشغيلية مرتبطة بحسابك في المنصة.</p></main></div>`;
}

function emailRaw(from: string, to: string, subject: string, html: string): string {
  return [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', html].join('\r\n');
}

/**
 * Delivers a decision message after its authoritative DB decision and in-app notice exist.
 * Cloudflare Email is intentionally optional: the source never treats an absent binding as sent.
 */
export async function deliverDecisionEmail(env: Env, input: DecisionEmailInput): Promise<DeliveryResult> {
  const html = emailHtml(input);
  const from = env.DECISION_EMAIL_FROM?.trim() || 'KSA.MEN <auth@ksa.men>';

  if (env.RESEND_API_KEY?.trim()) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [input.to], subject: input.subject, html }),
      });
      if (response.ok) return { delivered: true, channel: 'resend' };
    } catch {
      // The stored in-app notification remains authoritative; try only the configured fallback.
    }
  }

  const fallback = env.CLOUDFLARE_EMAIL;
  const EmailMessage = (globalThis as unknown as { EmailMessage?: new (from: string, to: string, raw: string) => unknown }).EmailMessage;
  if (fallback && EmailMessage) {
    try {
      await fallback.send(new EmailMessage(from, input.to, emailRaw(from, input.to, input.subject, html)));
      return { delivered: true, channel: 'cloudflare_email' };
    } catch {
      // Never surface provider internals to the member or rollback an already-recorded decision.
    }
  }
  return { delivered: false, channel: 'unavailable' };
}
