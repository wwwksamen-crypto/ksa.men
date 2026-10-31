import type { Env } from './core';

export type TransactionalEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type DecisionEmailInput = Omit<TransactionalEmailInput, 'html' | 'text'> & {
  name: string;
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

/**
 * Tries Resend first, then the configured native Cloudflare Email binding.
 * The caller remains responsible for its authoritative database action; a provider
 * failure is never presented to a member as implementation detail.
 */
export async function deliverTransactionalEmail(env: Env, input: TransactionalEmailInput): Promise<DeliveryResult> {
  const from = env.DECISION_EMAIL_FROM?.trim() || 'KSA.MEN <auth@ksa.men>';

  if (env.RESEND_API_KEY?.trim()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
        signal: controller.signal,
      });
      if (response.ok) return { delivered: true, channel: 'resend' };
    } catch {
      // Continue to the native backup route without surfacing provider internals.
    } finally {
      clearTimeout(timeout);
    }
  }

  if (env.CLOUDFLARE_EMAIL) {
    try {
      await env.CLOUDFLARE_EMAIL.send({ to: input.to, from, subject: input.subject, html: input.html, text: input.text });
      return { delivered: true, channel: 'cloudflare_email' };
    } catch {
      // The caller exposes a clear service-level message only if both routes fail.
    }
  }
  return { delivered: false, channel: 'unavailable' };
}

/** Delivers a decision after its authoritative DB decision and in-app notice exist. */
export async function deliverDecisionEmail(env: Env, input: DecisionEmailInput): Promise<DeliveryResult> {
  return deliverTransactionalEmail(env, {
    to: input.to,
    subject: input.subject,
    html: emailHtml(input),
    text: `${input.title}\n\n${input.message}\n\n${input.actionUrl}`,
  });
}
