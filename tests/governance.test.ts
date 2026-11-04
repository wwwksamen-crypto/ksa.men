import { describe, expect, it } from 'vitest';
import { auditRowHash } from '../server/core';
import { makeBackup, scrubTombstones } from '../server/backup';

describe('phase 2 governance controls', () => {
  it('binds each audit hash to predecessor, actor, action, detail, and time', async () => {
    const detail = JSON.stringify({ siteCount: 1, source: 'unit' });
    const first = await auditRowHash('legacy-anchor-v1:7', 2, 'site.publish', 'site-1', detail, 100);
    const same = await auditRowHash('legacy-anchor-v1:7', 2, 'site.publish', 'site-1', detail, 100);
    const altered = await auditRowHash('legacy-anchor-v1:7', 3, 'site.publish', 'site-1', detail, 100);
    const linked = await auditRowHash(first, 2, 'site.publish', 'site-1', detail, 101);
    expect(first).toBe(same);
    expect(altered).not.toBe(first);
    expect(linked).not.toBe(first);
  });

  it('removes tombstoned resources and their attached rows from a restore payload', () => {
    const tables: Record<string, any[]> = {
      deleted_tombstones: [
        { resource_type: 'account', resource_id: '12' },
        { resource_type: 'site', resource_id: 'site-12' },
        { resource_type: 'media', resource_id: 'media-12' },
        { resource_type: 'conversation', resource_id: 'conversation-12' },
      ],
      users: [{ id: 12 }, { id: 13 }],
      sites: [{ id: 'site-12', user_id: 12 }, { id: 'site-13', user_id: 13 }],
      media: [{ id: 'media-12', owner_id: 12 }, { id: 'media-13', owner_id: 13 }],
      conversations: [{ id: 'conversation-12', from_id: 12 }, { id: 'conversation-13', from_id: 13 }],
      messages: [{ id: 'message-12', conversation_id: 'conversation-12' }, { id: 'message-13', conversation_id: 'conversation-13' }],
      wallets: [{ user_id: 12 }, { user_id: 13 }],
      names: [{ site_id: 'site-12' }, { site_id: 'site-13' }],
    };
    const removed = scrubTombstones(tables);
    expect(tables.users).toEqual([{ id: 13 }]);
    expect(tables.sites).toEqual([{ id: 'site-13', user_id: 13 }]);
    expect(tables.media).toEqual([{ id: 'media-13', owner_id: 13 }]);
    expect(tables.conversations).toEqual([{ id: 'conversation-13', from_id: 13 }]);
    expect(tables.messages).toEqual([{ id: 'message-13', conversation_id: 'conversation-13' }]);
    expect(tables.wallets).toEqual([{ user_id: 13 }]);
    expect(tables.names).toEqual([{ site_id: 'site-13' }]);
    expect(removed.users).toBe(1);
  });
  it('round-trips an encrypted local snapshot and verifies content without restoring production or including auth sessions',async()=>{
    const tables:Record<string,unknown[]>={users:[{id:7,name:'هوية محلية'}],sites:[{id:'local',published:'{"name":"عربي"}'}],sessions:[{id:'never-back-up'}]};
    const schema=Object.keys(tables).map(name=>({name,type:'table',sql:'CREATE TABLE '+name+'(id TEXT)'}));
    let encrypted:Uint8Array|undefined;
    const secret='LOCAL-TEST-ONLY-ENCRYPTION';
    const env:any={BACKUP_ENCRYPTION_KEY:secret,DB:{prepare:(q:string)=>({all:async()=>({results:q.includes('sqlite_master')?schema:tables[q.replace('SELECT * FROM ','')]})})},MEDIA:{put:async(_key:string,bytes:Uint8Array)=>{encrypted=bytes;}}};
    const result=await makeBackup(env,'local-roundtrip');
    expect(result.encrypted).toBe(true);expect(result.tableCount).toBe(2);
    const bytes=encrypted!;expect(new TextDecoder().decode(bytes.slice(0,4))).toBe('KSA2');
    const material=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
    const key=await crypto.subtle.importKey('raw',material,{name:'AES-GCM'},false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(4,16)},key,bytes.slice(16));
    const payload=JSON.parse(new TextDecoder().decode(plain));
    expect(payload.tables).toEqual({users:tables.users,sites:tables.sites});expect(payload.excluded).toContain('sessions');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',plain)),b=>b.toString(16).padStart(2,'0')).join('');expect(hash).toBe(result.sha256);
  });
});
