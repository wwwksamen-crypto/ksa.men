import { sanitizeProfile } from '../../shared/profile-visibility';
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const field=(p:Record<string,unknown>,key:string)=>Array.isArray(p.hidden)&&p.hidden.includes(key)?'':text(p[key]);
const escapeVCard = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function profileVCard(profile: Record<string, unknown>, siteName: string, url: string) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const name = field(profile, 'name');
  const title = field(profile, 'title');
  const email = field(profile, 'email');
  const phone = field(profile, 'phone');
  const whatsapp = field(profile, 'whatsapp');
  const city = field(profile, 'city');
  const country = field(profile, 'country');
  const bio = field(profile, 'bio');
  if (name) { lines.push(`FN:${escapeVCard(name)}`); lines.push(`N:${escapeVCard(name)};;;;`); }
  if (title) lines.push(`TITLE:${escapeVCard(title)}`);
  if (siteName) lines.push(`ORG:${escapeVCard(siteName)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(email)}`);
  if (phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(phone)}`);
  if (whatsapp) lines.push(`TEL;TYPE=WORK:${escapeVCard(whatsapp)}`);
  if (city || country) lines.push(`ADR;TYPE=WORK:;;;${escapeVCard(city)};;${escapeVCard(country)};`);
  if (url) lines.push(`URL:${escapeVCard(url)}`);
  if (bio) lines.push(`NOTE:${escapeVCard(bio)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** A local serializer for the public profile route and the free QR/vCard tool. */
export function generateVCard(profile: Record<string, unknown>, siteName = '', url = '') {
  return profileVCard(sanitizeProfile(profile) as Record<string, unknown>, siteName, url);
}

