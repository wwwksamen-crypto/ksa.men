#!/usr/bin/env python3
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'client/src/Dashboard.tsx';s=p.read_text()
s=s.replace("return error instanceof TypeError || (error instanceof Error && /(?:failed to fetch|network(?:error)?|load failed)/i.test(error.message));","""const status = Number((error as { status?: number } | null)?.status || 0);
  return status >= 500 || status === 408 || error instanceof TypeError || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) || (error instanceof Error && /(?:failed to fetch|network(?:error)?|load failed)/i.test(error.message));""")
s=s.replace("    setLoading(true);\n    setLoadError('');","    if (!siteIdRef.current) setLoading(true);\n    setLoadError('');",1)
s=s.replace("else if (!siteIdRef.current && candidates[0]) await openSite(candidates[0]);","""else if (!siteIdRef.current && candidates[0]) await openSite(candidates[0]);
      else {
        const current = candidates.find((site) => site.id === siteIdRef.current);
        if (current) setActiveSite((existing) => existing ? { ...existing, ...current } : existing);
      }""")
needle="  useEffect(() => {\n    const interval = window.setInterval(() => { if (dirtyRef.current) void saveDraft(true); }, 15_000);"
s=s.replace(needle,"""  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => { void saveDraft(true); }, 900);
    return () => window.clearTimeout(timer);
  }, [draft, saveDraft]);
  useEffect(() => () => { siteIdRef.current = null; }, []);
  useEffect(() => {
    const interval = window.setInterval(() => { if (dirtyRef.current) void saveDraft(true); }, 15_000);""")
s=s.replace("      savingRef.current = false;\n    }\n  }, [notify, tr]);","""      savingRef.current = false;
      if (dirtyRef.current && revisionRef.current !== revision && siteIdRef.current === siteId) {
        window.setTimeout(() => { void saveDraft(true); }, 350);
      }
    }
  }, [notify, tr]);""",1)
s=s.replace("const initialReservationFlow = !activeSite && activeTab === 'editor' && unboundNames.length === 0;","const initialReservationFlow = !activeSite && activeTab === 'editor';")
old="""        {!activeSite ? <InitialNameReservation
          candidate={nameCandidate}"""
new="""        {!activeSite ? <>
          {(handovers.length > 0 || pendingTransfers.length > 0 || unboundNames.length > 0) && <section className="card dashboard-received-invites"><h2>{tr('خطوة جاهزة لك', 'A ready next step')}</h2><p className="muted">{tr('لديك اسم أو تسليم مرتبط بحسابك. يمكنك إكماله هنا دون حجز اسم إضافي.', 'A name or handover is associated with your account. Complete it here without reserving another name.')}</p>
            {unboundNames.map((item) => <div key={item.name}><strong dir="ltr">{item.name}.ksa.men</strong><button className="button" disabled={Boolean(attachingName)} onClick={() => void attachUnboundName(item.name, null)}>{tr('ابدأ بهذا الاسم', 'Start with this name')}</button></div>)}
            {handovers.map((item) => <div key={String(item.id)}><span>{tr('موقع بانتظار قبول تسليمه', 'A site awaits your handover acceptance')}</span><button className="button" onClick={() => void acceptHandover(String(item.id))}>{tr('قبول التسليم', 'Accept handover')}</button></div>)}
            {pendingTransfers.map((item) => <div key={String(item.id)}><strong dir="ltr">{String(item.name)}.ksa.men</strong><button className="button button--quiet" onClick={() => void acceptNameTransfer(String(item.id))}>{tr('قبول الاسم المنقول', 'Accept transferred name')}</button></div>)}
          </section>}
          <InitialNameReservation
          candidate={nameCandidate}"""
assert old in s;s=s.replace(old,new)
s=s.replace("          tr={tr}\n        /> : <>","          tr={tr}\n        /></> : <>",1)
s=s.replace("{tr('PIN والجهاز الموثوق', 'PIN and trusted device')}</h2></div></div><p", "{tr('PIN والجهاز الموثوق', 'PIN and trusted device')}</h2></div><a className=\"button button--quiet\" href=\"/auth?return=%2Fdashboard%3Ftab%3Dsettings\">{tr('إعادة التحقق بالبريد', 'Verify again by email')}</a></div><p")
s=s.replace("event.target.value.replace(/\\D/g, '').slice(0, 6)","event.target.value.replace(/[٠-٩۰-۹]/g, (character) => String(character.charCodeAt(0) - (character.charCodeAt(0) >= 0x6F0 ? 0x6F0 : 0x660))).replace(/\\D/g, '').slice(0, 6)")
s=s.replace("{review.reason ? String(review.reason) : tr('بانتظار قرار المراجع.', 'Awaiting reviewer decision.')}","{review.reason ? String(review.reason) : ['approved', 'approve'].includes(String(review.status || review.decision || '').toLowerCase()) ? tr('اعتمدت هذه اللقطة ونُشرت. التعديلات اللاحقة تبقى في المسودة.', 'This snapshot was approved and published. Later edits remain in the draft.') : ['rejected', 'reject'].includes(String(review.status || review.decision || '').toLowerCase()) ? tr('رُفضت هذه اللقطة. راجع ملاحظة المراجع.', 'This snapshot was rejected. Read the reviewer note.') : tr('بانتظار قرار المراجع.', 'Awaiting reviewer decision.')}")
p.write_text(s)
p=root/'client/src/dashboard.css';s=p.read_text()+"\n.dashboard-received-invites{display:grid;gap:16px}.dashboard-received-invites>div{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.dashboard-received-invites strong{overflow-wrap:anywhere;min-width:0}\n";p.write_text(s)
p=root/'client/src/main.tsx';s=p.read_text()
s=s.replace("const authDestination=(role:string)=>isStaffRole(role)?'/admin':'/dashboard';","""const authDestination=(role:string)=>{
 const back=new URLSearchParams(location.search).get('return');
 if(back&&back.length<2048&&(/^\\/dashboard(?:[?#]|$)/.test(back)||(isStaffRole(role)&&/^\\/admin(?:[?#]|$)/.test(back))))return back;
 return isStaffRole(role)?'/admin':'/dashboard';
};""")
s=s.replace("sessionStorage.clear();await refresh();", "sessionStorage.clear();['ksa-men:wallet-idempotency:transfer','ksa-men:wallet-idempotency:redeem'].forEach(key=>localStorage.removeItem(key));await refresh();")
s=s.replace("function Auth(){\n const{t,refresh,notify}=useApp();","function Auth(){\n const{t,refresh,notify,user}=useApp();")
s=s.replace("const[email,setEmail]=useState(''),[name,setName]", "const[email,setEmail]=useState(user?.email||''),[name,setName]",1)
p.write_text(s)
p=root/'server/operations.ts';s=p.read_text();s=s.replace('    if (!content) fail(404, "Content not found", "not_found");','    if (!content && slug === "footer") return c.json({ slug, available: false, content: null });\n    if (!content) fail(404, "Content not found", "not_found");');p.write_text(s)
p=root/'client/src/lib.tsx';s=p.read_text().replace("const english=localStorage.getItem('ksa-lang')==='en';","let english=document.documentElement.lang==='en';\n  try { english=localStorage.getItem('ksa-lang')==='en'||english; } catch { /* Language still follows the current document. */ }");p.write_text(s)
print('Scoped launch polish applied')
