from pathlib import Path
p=Path('client/src/main.tsx');s=p.read_text()
s=s.replace('<a href={prefix+(user?', '<button className="nav-sanad" type="button" onClick={()=>{setMenu(false);window.dispatchEvent(new Event("ksa:sanad-open"));}}><MessageCircle size={17}/>{t("معك سند","Ask Sanad")}</button>\n    <a href={prefix+(user?',1)
s=s.replace('<div className="header-tools"><button','<div className="header-tools">{!sub&&<button className="icon-button sanad-header-open" type="button" onClick={()=>window.dispatchEvent(new Event("ksa:sanad-open"))} aria-label={t("فتح دليل سند","Open Sanad guide")}><MessageCircle size={19}/></button>}<button',1)
s=s.replace('<img src="/assets/logo-emblem.webp" alt="" fetchPriority="high"/>','<span className="emblem-face"><img src="/assets/logo-emblem.webp" alt="" fetchPriority="high"/></span>',1)
p.write_text(s)
p=Path('client/src/style.css');s=p.read_text();s+='''\n/* Final composition and assistive entry points; no business styles or data. */
.nav-sanad{display:none;background:transparent;border:0;color:var(--accent);font:inherit;align-items:center;gap:8px;cursor:pointer;min-height:44px;text-align:start}
.emblem-face{display:grid;place-items:center;width:206px;height:206px;border-radius:48px;border:1px solid #d4d5b952;background:radial-gradient(ellipse at 24% 12%,#e0e2c252,transparent 64%),linear-gradient(150deg,#61776a42,#0a1e1699 45%,#4169535c);box-shadow:inset 0 2px 7px #ebefd736,inset 0 -6px 14px #0007,0 22px 32px #0006,0 0 52px #80ad6b15;transform:rotate(-6deg);position:relative;z-index:1}
.hero-emblem .emblem-face img{width:162px;max-height:162px;transform:rotate(6deg);filter:drop-shadow(0 4px 3px #0006)}
[data-theme="light"] .emblem-face{background:radial-gradient(ellipse at 24% 12%,#fff,transparent 64%),linear-gradient(145deg,#e1e5cf,#cadacb);box-shadow:inset 0 2px 7px #fff9,inset 0 -4px 12px #3d604533,0 16px 22px #203c2b19}
@media(max-width:640px){.sanad-header-open{display:none}.nav-sanad{display:flex}.emblem-face{width:170px;height:170px;border-radius:40px}.hero-emblem .emblem-face img{width:138px;max-height:138px}}
@media(max-width:360px){.emblem-face{width:155px;height:155px;border-radius:36px}.hero-emblem .emblem-face img{width:124px;max-height:124px}}
''';p.write_text(s)
p=Path('client/src/sanad.css');s=p.read_text().replace('position: sticky;','position: relative;',1).replace('bottom: clamp(12px, 2vw, 24px);','bottom: auto;',1)
s=s.replace('  .sanad-dialog {\n    inset-block: auto 0;\n    inline-size: 100vw;','  .sanad-dialog {\n    inset-block: auto 0;\n    inset-inline: 0;\n    inline-size: 100%;\n    max-inline-size: 100%;')
s=s.replace('    inline-size: 76px;','    inline-size: 110px;')
s+='''\n.sanad-transcript summary{cursor:pointer;min-height:44px;display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--accent);font-weight:700;list-style:none}
.sanad-transcript summary::after{content:'+';font-size:1.15rem}
.sanad-transcript[open] summary::after{content:'−'}
.sanad-transcript summary::-webkit-details-marker{display:none}
.sanad-transcript summary:focus-visible{outline:3px solid var(--gold);outline-offset:3px;border-radius:8px}
''';p.write_text(s)
p=Path('client/src/Sanad.tsx');s=p.read_text();s=s.replace('<section className="sanad-transcript" aria-labelledby="sanad-transcript-title">','<details className="sanad-transcript">').replace('<span className="sanad-label" id="sanad-transcript-title">{t(\'النص المسجل\', \'Recorded transcript\')}</span>','<summary>{t(\'قراءة النص الصوتي\', \'Read the audio transcript\')}</summary>');a=s.index('<details className="sanad-transcript">');b=s.index('</section>',a);s=s[:b]+s[b:].replace('</section>','</details>',1)
a=s.index('  const hideGuide = useCallback');s=s[:a]+'''  useEffect(() => {
    const openRequested = () => openGuide();
    window.addEventListener('ksa:sanad-open',openRequested);
    return () => window.removeEventListener('ksa:sanad-open',openRequested);
  },[openGuide]);
  useEffect(() => {
    if (!open) return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return () => {document.body.style.overflow=previous;};
  },[open]);

'''+s[a:];p.write_text(s)
p=Path('client/src/dashboard.css');s=p.read_text();s+='''\n/* A long DNS label must not move the save indicator outside a 320px screen. */
.dashboard-hero__actions{min-width:0;max-width:100%}
.dashboard-site-switch{min-width:0;max-inline-size:100%}
.dashboard-site-switch > span{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:640px){.dashboard-hero__actions{inline-size:100%;justify-items:start}.dashboard-site-switch{inline-size:100%}}
''';p.write_text(s)
p=Path('client/src/Admin.tsx');s=p.read_text().replace('<span className="admin-brand-glyph" aria-hidden="true">K</span>','<span className="admin-brand-glyph" aria-hidden="true"><img src="/assets/logo-emblem.webp" alt=""/></span>');p.write_text(s)
p=Path('client/src/admin.css');s=p.read_text();s+='\n.admin-console .admin-brand-glyph{display:grid;place-items:center;overflow:hidden}\n.admin-console .admin-brand-glyph img{width:27px;height:27px;object-fit:contain}\n';p.write_text(s)
p=Path('public/sw.js');s=p.read_text().replace("const VERSION='ksa-static-v2';","const VERSION='ksa-static-design-20261028';");s=s.replace("if(url.origin!==self.location.origin||event.request.method!=='GET')return;","if(url.origin!==self.location.origin||event.request.method!=='GET'||event.request.headers.has('Range'))return;");s=s.replace("if(response.ok&&response.headers.get('Cache-Control')?.includes('public'))", "if(response.status===200&&response.headers.get('Cache-Control')?.includes('public'))");p.write_text(s)
print('Measured visual edge cases polished; no account/DB/lock change.')
