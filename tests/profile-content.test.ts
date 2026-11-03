import { describe, expect, it } from 'vitest';
import { itemText, socialLink, webUrl, youtubeLink } from '../shared/profile-content';
import { profileItemIds, draftWithIdentities, reconcileItemIds, sanitizeProfile, withVisibility } from '../shared/profile-visibility';
import { normalizeProfile, publicationProfile, defaultProfile } from '../server/business';
import { parseDraft } from '../client/src/Dashboard';

describe('profile content and stable privacy identities', () => {
  it('detects the real platform from a safe URL alone, not labels or lookalike domains', () => {
    for (const [url, brand] of [['x.com/member','x'],['https://twitter.com/member','x'],['https://m.youtube.com/@member','youtube'],['https://youtu.be/abcdefghijk','youtube'],['https://instagram.com/member','instagram'],['https://linkedin.com/in/member','linkedin'],['https://wa.me/966555000000','whatsapp'],['https://t.me/member','telegram']]) expect(socialLink({url})?.brand, url).toBe(brand);
    expect(socialLink({label:'X',url:'https://x.com.evil.invalid/member'})?.brand).toBe('website');
    expect(socialLink('https://notinstagram.com/member')?.brand).toBe('website');
    for(const url of ['javascript:alert(1)','data:text/html,hi','https://user:secret@x.com/a','/relative','//x.com/a','https://x.com/a\nheader']) expect(socialLink(url),url).toBeNull();
    expect(webUrl('example.com/path')).toBe('https://example.com/path');
  });
  it('distinguishes YouTube channels from watch/short/live/embed videos, without accepting spoofed hosts', () => {
    for (const url of ['youtu.be/abcdefghijk?si=share','https://youtube.com/watch?v=abcdefghijk','https://m.youtube.com/shorts/abcdefghijk','https://youtube.com/live/abcdefghijk','https://www.youtube-nocookie.com/embed/abcdefghijk']) expect(youtubeLink(url)).toMatchObject({kind:'video',id:'abcdefghijk'});
    for (const url of ['https://youtube.com/@member','https://youtube.com/channel/UC-example','https://youtube.com/c/member','https://youtube.com/user/member']) expect(youtubeLink(url)).toMatchObject({kind:'channel'});
    for (const url of ['https://youtube.com.evil.invalid/watch?v=abcdefghijk','https://evil.youtube.com/watch?v=abcdefghijk','https://youtu.be/not-an-id','https://youtube.com/watch?v=bad']) expect(youtubeLink(url)).toBeNull();
  });
  it('renders the label and meaningful metadata in old and new text entries', () => {
    expect(itemText('العربية')).toBe('العربية');
    expect(itemText({title:'العربية',description:'لغة أم'})).toBe('العربية — لغة أم');
    expect(itemText({language:'English',proficiency:'Fluent'})).toBe('English — Fluent');
    expect(itemText({name:'تحليل',level:'متقدم'})).toBe('تحليل — متقدم');
    const parsed = parseDraft({...defaultProfile(),memberships:[{label:'عضو محلي'}],languages:[{language:'العربية',level:'لغة أم'}],skillRadar:{human:[{title:'تواصل'}],scientific:[],professional:[]}});
    expect(parsed.memberships[0]).toMatchObject({title:'عضو محلي'});
    expect(parsed.languages[0]).toMatchObject({title:'العربية',description:'لغة أم'});
    expect(parsed.skillRadar.human).toEqual(['تواصل']);
  });
  it('carries privacy identities through text edits, reorder, deletion, and structured normalization', () => {
    const before = {skills:['تحليل','قيادة','إدارة']};
    const ids = profileItemIds(before); const initial = {...before,itemIds:ids,hiddenItems:[`skills:${ids.skills[1]}`]};
    const edited = {...initial,skills:['تحليل','قيادة متقدمة','إدارة']}; edited.itemIds = reconcileItemIds(initial,edited);
    expect(edited.itemIds.skills[1]).toBe(ids.skills[1]);
    expect(sanitizeProfile(edited).skills).toEqual(['تحليل','إدارة']);
    const reordered = {...edited,skills:['إدارة','قيادة متقدمة','تحليل']}; reordered.itemIds = reconcileItemIds(edited,reordered);
    expect(sanitizeProfile(reordered).skills).toEqual(['إدارة','تحليل']);
    const removed = {...reordered,skills:['قيادة متقدمة','تحليل']}; removed.itemIds = reconcileItemIds(reordered,removed);
    expect(sanitizeProfile(removed).skills).toEqual(['تحليل']);
    const legacy = {...defaultProfile('هوية محلية'),experience:['خبرة قديمة'],skills:['', 'مرئية','مخفية']};
    const parsed = parseDraft(legacy); const hidden = `skills:${parsed.itemIds.skills[2]}`;
    const normalized = normalizeProfile({...parsed,hiddenItems:[hidden]},'',false,true);
    const published = publicationProfile(normalized);
    expect(sanitizeProfile(published).skills).toEqual(['مرئية']);
    expect(profileItemIds(published).experience).toEqual(parsed.itemIds.experience);
  });
  it('aligns legacy edited rows with approved identities without mutating either source', () => {
    const published = {skills:['تحليل','قيادة']}, draft = {skills:['تحليل','قيادة متقدمة']};
    const ids=profileItemIds(published), upgraded=draftWithIdentities(draft,published);
    expect(profileItemIds(upgraded).skills).toEqual(ids.skills);
    expect(sanitizeProfile({...upgraded,hiddenItems:[`skills:${ids.skills[1]}`]}).skills).toEqual(['تحليل']);
    expect(draft).not.toHaveProperty('itemIds');expect(published).not.toHaveProperty('itemIds');
  });
  it('does not let translations, item IDs, private notes, or any hidden path leak into the public representation', () => {
    const raw = {name:'هوية عامة',email:'hidden@local.invalid',notes:'PRIVATE',private:{secret:true},translations:{en:{email:'translated@local.invalid'}},skills:['A','B'],skillRadar:{human:['تواصل'],scientific:['تحليل'],professional:['هندسة']}};
    const ids=profileItemIds(raw);
    const output=sanitizeProfile(withVisibility(raw,{hidden:['email','skillRadar.scientific'],hiddenItems:[`skills:${ids.skills[1]}`],visible:true,listed:true,indexable:true,version:1}));
    expect(output.skills).toEqual(['A']); expect(output.skillRadar).toEqual({human:['تواصل'],scientific:[],professional:['هندسة']});
    for(const key of ['email','notes','private','translations','itemIds','hidden','hiddenItems']) expect(output).not.toHaveProperty(key);
  });
});
