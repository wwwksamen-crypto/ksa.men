import type { Env } from './core';
import { institutionalContact } from '../shared/institutional-contact';

export type TransactionalEmailInput = { to: string; subject: string; html: string; text?: string };
export type DecisionEmailInput = Omit<TransactionalEmailInput, 'html' | 'text'> & { name: string; title: string; message: string; actionLabel: string; actionUrl: string };
export type DeliveryResult = { delivered: boolean; channel: 'resend' | 'cloudflare_email' | 'unavailable'; uncertain?: boolean };
function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character);
}
function emailHtml(input: DecisionEmailInput): string {
  const title = escapeHtml(input.title), name = escapeHtml(input.name || 'عضو KSA.MEN'), message = escapeHtml(input.message).replace(/\n/g, '<br>');
  return `<div dir="rtl" style="margin:0;padding:32px 16px;background:#f4f7f5;color:#163629;font-family:Tahoma,Arial,sans-serif;line-height:1.75"><main style="max-width:620px;margin:0 auto;padding:30px;border:1px solid #d5e0d8;border-radius:22px;background:#fff"><p style="color:#8b6b2b;font-size:12px;font-weight:700">KSA.MEN / هوية مهنية</p><h1 style="color:#004422;font-size:25px">${title}</h1><p>مرحباً ${name}،</p><p>${message}</p><p><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#006837;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(input.actionLabel)}</a></p><p style="margin-top:26px;color:#5f7468;font-size:13px">هذه رسالة تشغيلية مرتبطة بحسابك في المنصة.</p></main></div>`;
}
/** Fail over using the exact same message; a verification fallback never creates a new code.
 * If the primary accepted a request but its response was lost, two identical copies may arrive.
 * No cross-provider system can promise exactly-once delivery for an ambiguous timeout.
 */
export async function deliverTransactionalEmail(env: Env, input: TransactionalEmailInput): Promise<DeliveryResult> {
  const from = institutionalContact.sender;
  let uncertain = false;
  if (env.RESEND_API_KEY?.trim()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, reply_to: institutionalContact.support, to: [input.to], subject: input.subject, html: input.html, text: input.text }), signal: controller.signal,
      });
      if (response.ok) return { delivered: true, channel: 'resend' };
      uncertain = response.status >= 500;
    } catch { uncertain = true; }
    finally { clearTimeout(timeout); }
  }
  if (env.CLOUDFLARE_EMAIL) {
    try {
      await env.CLOUDFLARE_EMAIL.send({ to: input.to, from: institutionalContact.support, subject: input.subject, html: input.html, text: input.text });
      return { delivered: true, channel: 'cloudflare_email' };
    } catch { return { delivered: false, channel: 'cloudflare_email', uncertain: true }; }
  }
  return { delivered: false, channel: 'unavailable', ...(uncertain ? { uncertain: true } : {}) };
}
export async function deliverDecisionEmail(env: Env, input: DecisionEmailInput): Promise<DeliveryResult> {
  return deliverTransactionalEmail(env, { to: input.to, subject: input.subject, html: emailHtml(input), text: `${input.title}\n\n${input.message}\n\n${input.actionUrl}` });
}
