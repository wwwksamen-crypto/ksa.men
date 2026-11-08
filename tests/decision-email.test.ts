import { afterEach, describe, expect, it, vi } from 'vitest';
import { mail } from '../server/auth';
import { deliverDecisionEmail, deliverTransactionalEmail } from '../server/decision-email';
const message = { to: 'member@example.test', subject: 'رمز', html: '<p>123456</p>', text: '123456' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('institutional transactional mail fallback', () => {
  it('uses Cloudflare when the Resend key is absent', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-message' });
    const result = await deliverDecisionEmail({ RESEND_API_KEY: '', CLOUDFLARE_EMAIL: { send } } as any, { to: message.to, name: 'عضو اختبار', subject: 'قرار', title: 'قرار الطلب', message: 'تم تسجيل القرار.', actionLabel: 'فتح المساحة', actionUrl: 'https://ksa.men/dashboard' });
    expect(result).toEqual({ delivered: true, channel: 'cloudflare_email' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: message.to, from: 'support@ksa.men', subject: 'قرار' }));
  });
  it('uses the same support fallback for a verification code', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'cf-code' });
    expect(await mail({ env: { RESEND_API_KEY: '', CLOUDFLARE_EMAIL: { send } } } as any, message.to, '123456')).toEqual({ delivered: true, channel: 'cloudflare_email' });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'support@ksa.men', text: expect.stringContaining('123456') }));
  });
  it('sends Resend first from the institutional support address, not a stale env override', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', {status:200})); vi.stubGlobal('fetch',fetcher);
    const send = vi.fn();
    expect(await deliverTransactionalEmail({ RESEND_API_KEY:'test-key', DECISION_EMAIL_FROM:'old@example.test', CLOUDFLARE_EMAIL:{send} } as any,message)).toEqual({delivered:true,channel:'resend'});
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({from:'KSA.MEN <support@ksa.men>',reply_to:'support@ksa.men'}); expect(send).not.toHaveBeenCalled();
  });
  it.each([400,401,403,429,500,502,503])('fails over after Resend HTTP %s using the identical code', async status => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status})));
    const send=vi.fn().mockResolvedValue({messageId:'cf'});
    expect(await deliverTransactionalEmail({RESEND_API_KEY:'test-key',CLOUDFLARE_EMAIL:{send}} as any,message)).toEqual({delivered:true,channel:'cloudflare_email'});
    expect(send).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith({...message,from:'support@ksa.men'});
  });
  it('fails over on network loss and keeps uncertainty if both channels fail', async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('network')));
    const send=vi.fn().mockResolvedValue({messageId:'cf'});
    expect((await deliverTransactionalEmail({RESEND_API_KEY:'test-key',CLOUDFLARE_EMAIL:{send}} as any,message)).delivered).toBe(true);
    send.mockRejectedValue(new Error('binding unavailable'));
    expect(await deliverTransactionalEmail({RESEND_API_KEY:'test-key',CLOUDFLARE_EMAIL:{send}} as any,message)).toEqual({delivered:false,channel:'cloudflare_email',uncertain:true});
  });
  it('fails over when the request deadline aborts', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch',vi.fn((_url, options:any)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))))));
      const send=vi.fn().mockResolvedValue({messageId:'cf'});
      const pending=deliverTransactionalEmail({RESEND_API_KEY:'test-key',CLOUDFLARE_EMAIL:{send}} as any,message);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({delivered:true,channel:'cloudflare_email'});
    } finally {vi.useRealTimers();}
  });
});
