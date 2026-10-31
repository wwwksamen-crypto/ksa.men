import { describe, expect, it } from 'vitest';
import { auditRowHash } from '../server/core';
import { scrubTombstones } from '../server/backup';

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
});
