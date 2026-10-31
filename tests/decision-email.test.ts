import { describe, expect, it, vi } from 'vitest';
import { deliverDecisionEmail } from '../server/decision-email';

describe('decision email fallback', () => {
  it('uses the configured Cloudflare binding only after the Resend path is unavailable', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-message' });
    const result = await deliverDecisionEmail({ RESEND_API_KEY: '', CLOUDFLARE_EMAIL: { send } } as any, {
      to: 'member@example.test', name: 'عضو اختبار', subject: 'قرار', title: 'قرار الطلب', message: 'تم تسجيل القرار.', actionLabel: 'فتح المساحة', actionUrl: 'https://ksa.men/dashboard',
    });
    expect(result).toEqual({ delivered: true, channel: 'cloudflare_email' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'member@example.test', from: 'KSA.MEN <auth@ksa.men>', subject: 'قرار' }));
  });
});
