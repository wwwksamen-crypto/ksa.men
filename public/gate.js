const form=document.getElementById('gate');
if(form)form.addEventListener('submit',async event=>{
 event.preventDefault();const error=document.getElementById('error');const button=form.querySelector('button');button.disabled=true;error.textContent='';
 try{const response=await fetch('/api/gate',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({password:document.getElementById('password').value})});const body=await response.json();if(!response.ok)throw new Error(body.error||'تعذر الدخول');location.reload();}
 catch(cause){error.textContent=cause.message||'تعذر الدخول. حاول مرة أخرى.';}
 finally{button.disabled=false;}
});
