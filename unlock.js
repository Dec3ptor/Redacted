/* Reverse a reversible Blackout file.
   Kept apart from the redaction app on purpose: the person opening a file is
   usually not the person who redacted it, and this page should do one thing. */
(function(){
'use strict';

var $=function(id){return document.getElementById(id);};
var pdfjsLib=window.pdfjsLib;
if(pdfjsLib)pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

var drop=$('drop'),fileInput=$('file'),panel=$('panel'),statusEl=$('status');
var currentFile=null,currentBytes=null,isPDF=false,payload=null,opened=null;

function say(m){statusEl.textContent=m||'';}
function bytes(n){
  if(!n&&n!==0)return 'unknown';
  var u=['B','KB','MB','GB'],i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}
  return (i?n.toFixed(1):n)+' '+u[i];
}

/* ---------- intake ---------- */
drop.onclick=function(){fileInput.click();};
drop.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInput.click();}};
['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('hot');});});
['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('hot');});});
drop.addEventListener('drop',function(e){if(e.dataTransfer.files.length)load(e.dataTransfer.files[0]);});
fileInput.onchange=function(){if(this.files.length)load(this.files[0]);};
$('newBtn').onclick=function(){fileInput.value='';reset();};

function reset(){
  currentFile=null;currentBytes=null;payload=null;opened=null;
  panel.hidden=true;$('found').hidden=true;$('opened').hidden=true;
  $('preview').hidden=true;$('pvbody').innerHTML='';
  $('key').value='';$('key').type='password';$('showKey').textContent='Show';
  drop.style.display='block';say('');
}

async function load(file){
  reset();
  currentFile=file;
  $('fname').textContent=file.name;
  isPDF=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  say('Reading file…');
  try{
    currentBytes=new Uint8Array(await file.arrayBuffer());
    payload=isPDF
      ? await BlackoutCore.extractPdfRecovery(currentBytes)
      : await BlackoutCore.extractPngRecovery(currentBytes);
  }catch(e){
    console.error(e);
    drop.style.display='block';
    say('That file could not be read.');
    return;
  }
  drop.style.display='none';
  panel.hidden=false;
  if(!payload){
    say('No Blackout recovery data in this file. Either it was redacted permanently — in which case the original is genuinely gone and nothing can bring it back — or it is not a Blackout file.');
    return;
  }
  $('found').hidden=false;
  say('Reversible recovery data found. Enter the recovery key to restore the original.');
  $('key').focus();
}

/* ---------- unlock ---------- */
$('showKey').onclick=function(){
  var k=$('key'),show=k.type==='password';
  k.type=show?'text':'password';
  this.textContent=show?'Hide':'Show';
};
$('key').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();$('unlock').click();}});

$('unlock').onclick=async function(){
  if(!payload)return;
  var key=$('key').value;
  if(!key){say('Enter the recovery key.');return;}
  this.disabled=true;
  say('Decrypting…');
  try{
    opened=await BlackoutCore.decryptRecovery(payload,key);
  }catch(e){
    // AES-GCM fails closed: a wrong key is indistinguishable from a tampered file.
    console.error(e);
    this.disabled=false;
    say('That key did not open this file. The key may be wrong, or the recovery data may have been altered since it was written.');
    return;
  }
  this.disabled=false;
  $('found').hidden=true;
  $('opened').hidden=false;
  showFacts();
  say('Key accepted. The exact original is available below — it exists only in this tab.');
  preview();
};

function fact(k,v){
  var d=document.createElement('div');
  var a=document.createElement('span');a.className='k';a.textContent=k;
  var b=document.createElement('span');b.className='v';b.textContent=v;
  d.appendChild(a);d.appendChild(b);$('facts').appendChild(d);
}

function showFacts(){
  $('facts').innerHTML='';
  var m=opened.meta||{},h=opened.header||{};
  fact('Original file',m.originalName||'unknown');
  fact('Type',m.originalMime||'unknown');
  fact('Size',bytes(opened.bytes.length));
  if(m.createdAt||m.redactedAt)fact('Redacted',new Date(m.redactedAt||m.createdAt).toLocaleString());
  fact('Envelope',(h.magic||'')+' · '+(h.suite||'')+' · '+(h.kdf||''));
}

function originalName(){
  var m=opened.meta||{};
  return m.originalName||'restored-original'+(isPDF?'.pdf':'.png');
}
function originalMime(){
  return (opened.meta&&opened.meta.originalMime)||(isPDF?'application/pdf':'image/png');
}

/* ---------- preview, so the key holder can see what came back ---------- */
async function preview(){
  var mime=originalMime(),body=$('pvbody');
  try{
    if(mime.indexOf('image/')===0){
      var img=new Image();
      img.src=URL.createObjectURL(new Blob([opened.bytes],{type:mime}));
      img.onload=function(){URL.revokeObjectURL(img.src);};
      body.appendChild(img);
      $('preview').hidden=false;
      return;
    }
    if(!pdfjsLib)return;
    // pdf.js transfers the array it is given, so hand it a copy.
    var pdf=await pdfjsLib.getDocument({data:opened.bytes.slice()}).promise;
    var page=await pdf.getPage(1),vp=page.getViewport({scale:1.5});
    var c=document.createElement('canvas');
    c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
    var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:ctx,viewport:vp}).promise;
    body.appendChild(c);
    $('preview').hidden=false;
  }catch(e){ console.error(e); }   // a preview that fails must not block the save
}

/* ---------- delivery ---------- */
async function requestHandle(name,mime){
  if(!window.showSaveFilePicker)return undefined;
  var accept={};accept[mime]=[mime==='application/pdf'?'.pdf':'.png'];
  try{
    return await window.showSaveFilePicker({suggestedName:name,
      types:[{description:mime==='application/pdf'?'PDF document':'Image',accept:accept}]});
  }catch(e){
    if(e&&e.name==='AbortError')return null;   // the person cancelled
    return undefined;                          // unsupported — fall back
  }
}
async function deliver(blob,name,handle){
  if(handle){var w=await handle.createWritable();await w.write(blob);await w.close();return 'Saved to the location you chose.';}
  var a=document.createElement('a'),url=URL.createObjectURL(blob);
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},5000);
  return 'Saved using your browser download flow.';
}

$('saveOriginal').onclick=async function(){
  if(!opened)return;
  var name=originalName(),mime=originalMime();
  var handle=await requestHandle(name,mime);
  if(handle===null){say('Save cancelled. Nothing was written.');return;}
  try{
    say(await deliver(new Blob([opened.bytes],{type:mime}),name,handle)+' This is the original, byte for byte.');
  }catch(e){console.error(e);say('Saving failed. Try again, or choose a different location.');}
};

/* Strip the recovery block. The visible redaction survives; the encrypted
   original does not. This is the answer to "what if the key gets out later" —
   run it before the file leaves your control and there is nothing to reopen. */
$('makePermanent').onclick=async function(){
  if(!currentBytes)return;
  if(!window.confirm('Write a copy with the encrypted original removed?\n\nThe redaction stays. The recovery does not — no key will reopen the copy you are about to save. Your current file is left untouched.'))return;
  this.disabled=true;
  say('Removing the recovery data…');
  try{
    var base=(currentFile.name||'file').replace(/\.[^.]+$/,'').replace(/-reversible$/,'');
    var name,blob;
    if(isPDF){
      name=base+'-permanent.pdf';
      blob=new Blob([await BlackoutCore.stripPdfRecovery(currentBytes)],{type:'application/pdf'});
    }else{
      name=base+'-permanent.png';
      blob=await BlackoutCore.stripPngRecovery(currentBytes);
    }
    /* Prove it against the raw bytes. Following the catalog reference would
       pass on a file that still carries an orphaned copy of the ciphertext,
       which is exactly the kind of false assurance this tool exists to stop. */
    var check=new Uint8Array(await blob.arrayBuffer());
    if(BlackoutCore.hasRecoveryBytes(check)){
      this.disabled=false;
      say('The recovery data could not be fully removed from this file, so nothing was saved. Redact the original permanently instead.');
      return;
    }
    var handle=await requestHandle(name,isPDF?'application/pdf':'image/png');
    if(handle===null){this.disabled=false;say('Save cancelled. Nothing was written.');return;}
    say(await deliver(blob,name,handle)+' Verified: the saved copy carries no recovery data and cannot be reversed.');
  }catch(e){
    console.error(e);
    say('That file could not be rewritten. Nothing was saved.');
  }
  this.disabled=false;
};

})();
