import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const restricted = [
  'company-registration.webp',
  'company-bank.webp',
  'SA5380000296608010947219',
  '296000010006080947219',
];

describe('public disclosure boundary', () => {
  it('does not ship supplied official-document assets', () => {
    expect(existsSync(resolve(root, 'public/assets/company-registration.webp'))).toBe(false);
    expect(existsSync(resolve(root, 'public/assets/company-bank.webp'))).toBe(false);
  });

  it('keeps restricted document identifiers out of the public shell and PWA cache', () => {
    const publicFiles = ['client/src/main.tsx', 'client/src/style.css', 'public/sw.js', 'index.html', 'public/manifest.webmanifest'];
    for (const file of publicFiles) {
      const text = read(file);
      for (const restrictedValue of restricted) expect(text, `${file} exposes ${restrictedValue}`).not.toContain(restrictedValue);
    }
    const worker = read('public/sw.js');
    expect(worker).toContain('sensitivePublicDocument');
    expect(worker).toContain("!url.pathname.startsWith('/assets/')");
    expect(worker).toContain("url.pathname==='/export/badge'");
    expect(worker).toContain("!url.searchParams.has('site')");
  });

  it('adds bilingual safe public content without transfer-account values', () => {
    const migration = read('migrations/0010_public_disclosure_and_content.sql');
    expect(migration).toContain("'about'");
    expect(migration).toContain("'blog'");
    expect(migration).toContain("'privacy'");
    expect(migration).toContain("'terms'");
    for (const restrictedValue of restricted) expect(migration).not.toContain(restrictedValue);
  });

  it('keeps the current member-only terms copy in the non-destructive cleanup migration', () => {
    const migration = read('migrations/0015_terms_current_product_scope.sql');
    expect(migration).toContain('حفظ المسودة أو رفع ملف لا ينشره تلقائياً');
    expect(migration).toContain('نقاط التميز المهني رصيد خدمات غير نقدي');
    expect(migration).toContain('Saving a draft or uploading a file does not publish it automatically');
    expect(migration).toContain('Professional Excellence Points are non-cash service credits');
  });
});
