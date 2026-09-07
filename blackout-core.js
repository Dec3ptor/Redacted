(function(){
'use strict';
var CFG=window.BLACKOUT_CONFIG||{productName:'Blackout',website:'',watermarkEnabled:true};
var te=new TextEncoder(),td=new TextDecoder();
function join(){var a=[].slice.call(arguments),n=a.reduce(function(s,x){return s+x.length;},0),o=new Uint8Array(n),p=0;a.forEach(function(x){o.set(x,p);p+=x.length;});return o;}
function u32(n){var a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n);return a;}
function readU32(a,o){return new DataView(a.buffer,a.byteOffset+o,4).getUint32(0);}
function b64url(a){var s='',i;for(i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function fromB64url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
function generateRecoveryKey(){var a=crypto.getRandomValues(new Uint8Array(32));return 'BO2-'+b64url(a);}
function isGeneratedKey(s){return /^BO2-[A-Za-z0-9_-]{43}$/.test(String(s||''));}
var PBKDF2_ITERATIONS=600000;
/* The header names the iteration count so a future format can raise it and old
   files still open. Reading it back is safe: the header is the GCM additional
   data, so a tampered count changes the derived key and fails the tag. The
   bounds only stop a malformed file from asking for absurd work. */
function iterationsFrom(header){
  var m=/PBKDF2-HMAC-SHA256-(\d+)/.exec((header&&header.kdf)||'');
  var n=m?parseInt(m[1],10):PBKDF2_ITERATIONS;
  return (n>=100000&&n<=10000000)?n:PBKDF2_ITERATIONS;
}
async function keyFor(keyText,salt,iterations){if(isGeneratedKey(keyText)){var raw=fromB64url(keyText.slice(4));return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
  var material=await crypto.subtle.importKey('raw',te.encode(String(keyText)),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:iterations||PBKDF2_ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptRecovery(originalBytes,keyText,meta){var raw=originalBytes instanceof Uint8Array?originalBytes:new Uint8Array(originalBytes);var salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));var header={magic:'BLACKOUT-R2',version:2,suite:'AES-256-GCM',kdf:isGeneratedKey(keyText)?'RAW-256':'PBKDF2-HMAC-SHA256-'+PBKDF2_ITERATIONS,salt:b64url(salt),iv:b64url(iv)};var headerBytes=te.encode(JSON.stringify(header));var metaBytes=te.encode(JSON.stringify(meta||{}));var plain=join(u32(metaBytes.length),metaBytes,raw);var key=await keyFor(keyText,salt,PBKDF2_ITERATIONS);var cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv,additionalData:headerBytes,tagLength:128},key,plain));return join(te.encode('BOR2'),u32(headerBytes.length),headerBytes,cipher);}
async function decryptRecovery(envelope,keyText){var d=envelope instanceof Uint8Array?envelope:new Uint8Array(envelope);if(td.decode(d.slice(0,4))!=='BOR2')throw new Error('Not a Blackout R2 recovery payload');var hl=readU32(d,4),headerBytes=d.slice(8,8+hl),header=JSON.parse(td.decode(headerBytes));if(header.magic!=='BLACKOUT-R2'||header.version!==2)throw new Error('Unsupported recovery version');var salt=fromB64url(header.salt),iv=fromB64url(header.iv),key=await keyFor(keyText,salt,iterationsFrom(header));var plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:iv,additionalData:headerBytes,tagLength:128},key,d.slice(8+hl)));var ml=readU32(plain,0),meta=JSON.parse(td.decode(plain.slice(4,4+ml)));return{header:header,meta:meta,bytes:plain.slice(4+ml)};}
// PNG private ancillary chunk. Lower-case first byte marks it ancillary; second lower-case marks it private.
var crcTable=null;function crc32(bytes){if(!crcTable){crcTable=[];for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}}var c=0xffffffff;for(var i=0;i<bytes.length;i++)c=crcTable[(c^bytes[i])&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function makeChunk(type,data){var t=te.encode(type),body=join(t,data);return join(u32(data.length),body,u32(crc32(body)));}
function findPngChunk(bytes,type){if(bytes.length<12||td.decode(bytes.slice(1,4))!=='PNG')return null;var o=8;while(o+12<=bytes.length){var len=readU32(bytes,o),t=td.decode(bytes.slice(o+4,o+8));if(t===type)return bytes.slice(o+8,o+8+len);o+=12+len;}return null;}
function insertPngChunk(bytes,type,data){var o=8,parts=[bytes.slice(0,8)],inserted=false;while(o+12<=bytes.length){var len=readU32(bytes,o),t=td.decode(bytes.slice(o+4,o+8)),chunk=bytes.slice(o,o+12+len);if(t!==type){if(t==='IEND'&&!inserted){parts.push(makeChunk(type,data));inserted=true;}parts.push(chunk);}o+=12+len;}return join.apply(null,parts);}
/* PNG chunk types must be four ASCII letters. The original 'boR2' ended in a
   digit, which is malformed and can be rejected outright by a strict decoder.
   'boRv' is well formed: ancillary (b), private (o), reserved bit clear (R),
   safe to copy (v) so an editor that does not understand it preserves it.
   The old type is still read so files written before the fix still open. */
var PNG_RECOVERY='boRv',PNG_RECOVERY_LEGACY='boR2';
function removePngChunk(bytes,type){if(bytes.length<12)return bytes;var o=8,parts=[bytes.slice(0,8)];while(o+12<=bytes.length){var len=readU32(bytes,o),t=td.decode(bytes.slice(o+4,o+8));if(t!==type)parts.push(bytes.slice(o,o+12+len));o+=12+len;}return join.apply(null,parts);}
async function putPngRecovery(blob,envelope){var bytes=new Uint8Array(await blob.arrayBuffer());return new Blob([insertPngChunk(bytes,PNG_RECOVERY,envelope)],{type:'image/png'});}
async function extractPngRecovery(blobOrBytes){var b=blobOrBytes instanceof Uint8Array?blobOrBytes:new Uint8Array(await blobOrBytes.arrayBuffer());return findPngChunk(b,PNG_RECOVERY)||findPngChunk(b,PNG_RECOVERY_LEGACY);}
async function stripPngRecovery(blobOrBytes){var b=blobOrBytes instanceof Uint8Array?blobOrBytes:new Uint8Array(await blobOrBytes.arrayBuffer());return new Blob([removePngChunk(removePngChunk(b,PNG_RECOVERY),PNG_RECOVERY_LEGACY)],{type:'image/png'});}
async function attachPdfRecovery(pdfBytes,envelope){var P=window.PDFLib;if(!P)throw new Error('pdf-lib is required');var doc=await P.PDFDocument.load(pdfBytes,{updateMetadata:false});var old=doc.catalog.get(P.PDFName.of('BlackoutRecovery'));if(old)doc.catalog.delete(P.PDFName.of('BlackoutRecovery'));var stream=doc.context.stream(envelope,{Type:'BlackoutRecovery',Version:2,Cipher:'AES256GCM'}),ref=doc.context.register(stream);doc.catalog.set(P.PDFName.of('BlackoutRecovery'),ref);return new Uint8Array(await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false}));}
/* Removing the catalog entry only orphans the stream — pdf-lib still writes
   the object, so the ciphertext would stay in the file and the key would still
   open it. The object itself has to go. */
async function stripPdfRecovery(pdfBytes){var P=window.PDFLib;if(!P)throw new Error('pdf-lib is required');
  var doc=await P.PDFDocument.load(pdfBytes,{updateMetadata:false});
  var k=P.PDFName.of('BlackoutRecovery'),ref=doc.catalog.get(k);
  if(ref){doc.catalog.delete(k);if(ref instanceof P.PDFRef)doc.context.delete(ref);}
  relinkPdfWatermark(doc);
  return new Uint8Array(await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false}));}

/* A file that was reversible carries a mark linking to the unlock page. Once
   the recovery is gone that link is wrong, so repoint it at the app. Only the
   annotation changes — the drawn mark is identical in both modes, so no page
   content is touched. */
function relinkPdfWatermark(doc){
  if(!CFG.watermarkEnabled)return doc;
  var P=window.PDFLib,base=siteBase();
  if(!base)return doc;
  doc.getPages().forEach(function(page){
    var key=P.PDFName.of('Annots'),annots=page.node.get(key);
    if(!annots||typeof annots.asArray!=='function')return;
    var kept=annots.asArray().filter(function(r){
      try{
        var a=doc.context.lookup(r),act=a&&a.get&&a.get(P.PDFName.of('A'));
        var uri=act&&act.get&&act.get(P.PDFName.of('URI'));
        var v=uri&&uri.asString?uri.asString():'';
        if(v.indexOf(base)!==0)return true;         // not ours, leave it
        act.set(P.PDFName.of('URI'),P.PDFString.of(base));
        return true;
      }catch(e){return true;}
    });
    page.node.set(key,doc.context.obj(kept));
  });
  return doc;
}

/* The honest check after stripping: the envelope magic must not appear
   anywhere in the file. Following the catalog reference is not enough — an
   orphaned stream is still readable by anything that parses objects directly. */
function hasRecoveryBytes(bytes){
  var b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  for(var i=0;i+4<=b.length;i++)
    if(b[i]===66&&b[i+1]===79&&b[i+2]===82&&b[i+3]===50)return true;   // 'BOR2'
  return false;
}
async function extractPdfRecovery(pdfBytes){var P=window.PDFLib;if(!P)return null;try{var doc=await P.PDFDocument.load(pdfBytes,{updateMetadata:false});var ref=doc.catalog.get(P.PDFName.of('BlackoutRecovery'));if(!ref)return null;var raw=doc.context.lookup(ref);if(!raw)return null;if(raw.contents)return new Uint8Array(raw.contents);if(typeof raw.getContents==='function')return new Uint8Array(raw.getContents());return null;}catch(e){return null;}}
function siteBase(){var u=CFG.siteUrl||'';return u&&u.slice(-1)!=='/'?u+'/':u;}
/* The mark reads the same either way; only where it points changes. A
   reversible file links to the page that reverses it, a permanent one to the
   app. Keeping the drawn text identical means making a file permanent never
   has to paint over text that is already in the content stream — covering
   text with a box is the exact mistake this tool exists to prevent. */
function brandTarget(reversible){var b=siteBase();if(!b)return'';return reversible?b+(CFG.unlockPath||'unlock.html'):b;}
function prettyUrl(u){return String(u||'').replace(/^https?:\/\//,'').replace(/\/$/,'');}
function brandLines(reversible){
  return{
    top:'Redacted with '+(CFG.productName||'Blackout'),
    bottom:CFG.website||prettyUrl(siteBase()),
    url:brandTarget(reversible)
  };
}
function applyCanvasWatermark(canvas){if(!CFG.watermarkEnabled)return canvas;var ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,scale=Math.max(.55,Math.min(2.2,Math.min(w,h)/900)),pad=Math.round(12*scale),barW=Math.round(24*scale),barH=Math.max(4,Math.round(7*scale)),font=Math.max(11,Math.round(14*scale)),small=Math.max(9,Math.round(11*scale)),lines=brandLines(false);ctx.save();ctx.font='600 '+font+'px Arial, sans-serif';var tw=ctx.measureText(lines.top).width,bw=lines.bottom?(function(){ctx.font='500 '+small+'px Arial, sans-serif';return ctx.measureText(lines.bottom).width;})():0;var boxW=Math.ceil(Math.max(barW+8*scale+tw,bw)+pad*2),boxH=Math.ceil((lines.bottom?font+small+9*scale:font+6*scale)+pad*2),x=w-boxW-Math.round(10*scale),y=h-boxH-Math.round(10*scale);ctx.fillStyle='rgba(255,255,255,.90)';ctx.fillRect(x,y,boxW,boxH);ctx.fillStyle='#000';ctx.fillRect(x+pad,y+pad+Math.round((font-barH)/2),barW,barH);ctx.font='600 '+font+'px Arial, sans-serif';ctx.textBaseline='top';ctx.fillText(lines.top,x+pad+barW+Math.round(8*scale),y+pad);if(lines.bottom){ctx.font='500 '+small+'px Arial, sans-serif';ctx.fillStyle='#555';ctx.fillText(lines.bottom,x+pad,y+pad+font+Math.round(5*scale));}ctx.restore();return canvas;}
async function applyPdfWatermark(doc,reversible){if(!CFG.watermarkEnabled)return doc;var P=window.PDFLib,regular=await doc.embedFont(P.StandardFonts.Helvetica),bold=await doc.embedFont(P.StandardFonts.HelveticaBold),lines=brandLines(reversible);doc.getPages().forEach(function(page){var size=page.getSize(),s=Math.max(.7,Math.min(1.15,Math.min(size.width,size.height)/612)),font=8*s,small=6.5*s,pad=5*s,barW=14*s,barH=4*s,topW=bold.widthOfTextAtSize(lines.top,font),bottomW=lines.bottom?regular.widthOfTextAtSize(lines.bottom,small):0,boxW=Math.max(barW+5*s+topW,bottomW)+pad*2,boxH=(lines.bottom?font+small+6*s:font+3*s)+pad*2,x=size.width-boxW-8*s,y=8*s;page.drawRectangle({x:x,y:y,width:boxW,height:boxH,color:P.rgb(1,1,1),opacity:.90});page.drawRectangle({x:x+pad,y:y+boxH-pad-font/2-barH/2,width:barW,height:barH,color:P.rgb(0,0,0)});page.drawText(lines.top,{x:x+pad+barW+5*s,y:y+boxH-pad-font,size:font,font:bold,color:P.rgb(0,0,0)});if(lines.bottom)page.drawText(lines.bottom,{x:x+pad,y:y+pad,size:small,font:regular,color:P.rgb(.28,.28,.28)});
    if(lines.url)linkRegion(doc,page,x,y,boxW,boxH,lines.url);});return doc;}
/* A Link annotation with a URI action, sized to the mark. Border width 0 so it
   is invisible; the mark itself is the visible affordance. */
function linkRegion(doc,page,x,y,w,h,url){var P=window.PDFLib;
  var annot=doc.context.obj({Type:P.PDFName.of('Annot'),Subtype:P.PDFName.of('Link'),
    Rect:doc.context.obj([x,y,x+w,y+h]),Border:doc.context.obj([0,0,0]),
    F:4,A:doc.context.obj({Type:P.PDFName.of('Action'),S:P.PDFName.of('URI'),URI:P.PDFString.of(url)})});
  var ref=doc.context.register(annot),key=P.PDFName.of('Annots'),existing=page.node.get(key);
  if(existing&&typeof existing.push==='function')existing.push(ref);
  else page.node.set(key,doc.context.obj([ref]));}
// Local-only handoff between redaction and metadata pages.
function db(){return new Promise(function(resolve,reject){var r=indexedDB.open('blackout-local',1);r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains('handoff'))r.result.createObjectStore('handoff');};r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(r.error);};});}
async function putHandoff(item,slot){var d=await db();return new Promise(function(resolve,reject){var tx=d.transaction('handoff','readwrite');tx.objectStore('handoff').put(item,slot||'current');tx.oncomplete=function(){d.close();resolve();};tx.onerror=function(){d.close();reject(tx.error);};});}
async function getHandoff(slot){var d=await db();return new Promise(function(resolve,reject){var tx=d.transaction('handoff','readonly'),r=tx.objectStore('handoff').get(slot||'current');r.onsuccess=function(){var v=r.result||null;tx.oncomplete=function(){d.close();resolve(v);};};r.onerror=function(){d.close();reject(r.error);};});}
async function clearHandoff(slot){var d=await db();return new Promise(function(resolve,reject){var tx=d.transaction('handoff','readwrite');tx.objectStore('handoff').delete(slot||'current');tx.oncomplete=function(){d.close();resolve();};tx.onerror=function(){d.close();reject(tx.error);};});}
window.BlackoutCore={slots:true,config:CFG,generateRecoveryKey:generateRecoveryKey,isGeneratedKey:isGeneratedKey,encryptRecovery:encryptRecovery,decryptRecovery:decryptRecovery,putPngRecovery:putPngRecovery,extractPngRecovery:extractPngRecovery,attachPdfRecovery:attachPdfRecovery,extractPdfRecovery:extractPdfRecovery,applyCanvasWatermark:applyCanvasWatermark,applyPdfWatermark:applyPdfWatermark,stripPngRecovery:stripPngRecovery,stripPdfRecovery:stripPdfRecovery,hasRecoveryBytes:hasRecoveryBytes,putHandoff:putHandoff,getHandoff:getHandoff,clearHandoff:clearHandoff};
})();
