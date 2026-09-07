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
  await applyPdfWatermark(doc,false);   // removes the reversible mark, stamps the permanent one
  return new Uint8Array(await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false}));}

/* A file that was reversible carries a mark linking to the unlock page. Once
   the recovery is gone that link is wrong, so repoint it at the app. Only the
   annotation changes — the drawn mark is identical in both modes, so no page
   content is touched. */
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
/* ============================================================
   The exported mark.

   Two lines, bottom-right:

       ▬▬  Redacted with Blackout
       [ REVERSIBLE ]  example.com/unlock.html

   The second line only appears on a reversible file. Because the two
   variants differ in what they say, making a file permanent has to remove
   the old mark rather than cover it — so the mark is drawn into its own
   content stream, referenced from the page, and deleted outright when the
   file is made permanent. Painting a box over text we no longer want is
   the one thing this tool exists to tell people not to do.
   ============================================================ */
var MARK_KEY='BlackoutMark';
var CAP=.717;              // Helvetica cap height, in ems
var TRACK=.12;             // letterspacing on the REVERSIBLE chip, in ems

function siteBase(){var u=CFG.siteUrl||'';return u&&u.slice(-1)!=='/'?u+'/':u;}
/* The link carries a marker so the unlock page knows the reader arrived from
   a document rather than from the site, and can lead with the file prompt. */
function brandTarget(reversible){
  var b=siteBase();if(!b)return'';
  return reversible?b+(CFG.unlockPath||'unlock.html')+'?from=mark':b;
}
function prettyUrl(u){return String(u||'').replace(/^https?:\/\//,'').replace(/\?.*$/,'').replace(/\/$/,'');}
function brandLines(reversible){
  return{
    top:'Redacted with '+(CFG.productName||'Blackout'),
    chip:reversible?'REVERSIBLE':'',
    bottom:CFG.website||prettyUrl(brandTarget(reversible)||siteBase()),
    url:brandTarget(reversible)
  };
}

function trackedWidth(font,text,size){
  return font.widthOfTextAtSize(text,size)+TRACK*size*Math.max(0,text.length-1);
}

/* Geometry shared by the drawing and the link rectangle. */
function markLayout(size,bold,regular,reversible){
  var lines=brandLines(reversible);
  var s=Math.max(.7,Math.min(1.15,Math.min(size.width,size.height)/612));
  var f1=8*s,f2=5.4*s,f3=6.2*s;
  var pad=6*s,barW=15*s,barH=3.2*s,gap=5*s,lineGap=5.5*s;
  var chipPadX=3.4*s,chipPadY=2.2*s;
  var chipTextW=lines.chip?trackedWidth(bold,lines.chip,f2):0;
  var chipW=lines.chip?chipTextW+chipPadX*2:0;
  var chipH=lines.chip?f2*CAP+chipPadY*2:0;
  var urlW=lines.bottom?regular.widthOfTextAtSize(lines.bottom,f3):0;
  var row1W=barW+gap+bold.widthOfTextAtSize(lines.top,f1);
  var row2W=(lines.chip?chipW+gap:0)+urlW;
  var rowH=Math.max(chipH,f3*CAP);
  var boxW=Math.max(row1W,row2W)+pad*2;
  var boxH=pad*2+f1*CAP+lineGap+rowH;
  return{lines:lines,s:s,f1:f1,f2:f2,f3:f3,pad:pad,barW:barW,barH:barH,gap:gap,
    chipW:chipW,chipH:chipH,chipPadX:chipPadX,rowH:rowH,
    boxW:boxW,boxH:boxH,x:size.width-boxW-8*s,y:8*s};
}

function pdfStr(t){return '('+String(t).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')+')';}
function n(v){return (Math.round(v*1000)/1000).toString();}

/* The mark as PDF operators, drawn into a stream of its own. */
function markOperators(L,fBold,fReg){
  var o=[],x=L.x,y=L.y,W=L.boxW,H=L.boxH;
  o.push('q');
  o.push('1 1 1 rg '+n(x)+' '+n(y)+' '+n(W)+' '+n(H)+' re f');          // ground

  // row 1 — bar and wordmark, the bar centred on the cap height of the text
  var base1=y+H-L.pad-L.f1*CAP;
  var barY=base1+L.f1*CAP/2-L.barH/2;
  o.push('0 0 0 rg '+n(x+L.pad)+' '+n(barY)+' '+n(L.barW)+' '+n(L.barH)+' re f');
  o.push('BT /'+fBold+' '+n(L.f1)+' Tf 1 0 0 1 '+n(x+L.pad+L.barW+L.gap)+' '+n(base1)+' Tm '+pdfStr(L.lines.top)+' Tj ET');

  // row 2 — the reversible chip, then the address
  var rowY=y+L.pad,cx=x+L.pad;
  if(L.lines.chip){
    var chipY=rowY+(L.rowH-L.chipH)/2;
    o.push('0 0 0 RG '+n(.6*L.s)+' w '+n(cx)+' '+n(chipY)+' '+n(L.chipW)+' '+n(L.chipH)+' re S');
    var ctBase=chipY+(L.chipH-L.f2*CAP)/2;
    o.push('BT /'+fBold+' '+n(L.f2)+' Tf '+n(TRACK*L.f2)+' Tc 1 0 0 1 '+n(cx+L.chipPadX)+' '+n(ctBase)+' Tm '+pdfStr(L.lines.chip)+' Tj 0 Tc ET');
    cx+=L.chipW+L.gap;
  }
  if(L.lines.bottom){
    var uBase=rowY+(L.rowH-L.f3*CAP)/2;
    o.push('.35 .35 .35 rg BT /'+fReg+' '+n(L.f3)+' Tf 1 0 0 1 '+n(cx)+' '+n(uBase)+' Tm '+pdfStr(L.lines.bottom)+' Tj ET');
  }
  o.push('Q');
  return o.join('\n');
}

function contentsArray(doc,page){
  var P=window.PDFLib,k=P.PDFName.of('Contents'),c=page.node.get(k);
  if(c&&typeof c.asArray==='function')return c;
  var arr=doc.context.obj(c?[c]:[]);
  page.node.set(k,arr);
  return page.node.get(k);
}

/* Delete the mark stream, its page reference and the link that went with it. */
function removePdfMark(doc){
  var P=window.PDFLib,key=P.PDFName.of(MARK_KEY),base=siteBase();
  doc.getPages().forEach(function(page){
    var ref=page.node.get(key);
    if(ref){
      var c=contentsArray(doc,page);
      var kept=c.asArray().filter(function(r){return !(r&&ref&&r.tag===ref.tag);});
      page.node.set(P.PDFName.of('Contents'),doc.context.obj(kept));
      page.node.delete(key);
      try{doc.context.delete(ref);}catch(e){}
    }
    var an=page.node.get(P.PDFName.of('Annots'));
    if(an&&typeof an.asArray==='function'){
      var keepA=an.asArray().filter(function(r){
        try{
          var a=doc.context.lookup(r),act=a&&a.get&&a.get(P.PDFName.of('A'));
          var uri=act&&act.get&&act.get(P.PDFName.of('URI'));
          var v=uri&&uri.asString?uri.asString():'';
          return !(base&&v.indexOf(base)===0);
        }catch(e){return true;}
      });
      page.node.set(P.PDFName.of('Annots'),doc.context.obj(keepA));
    }
  });
  return doc;
}

async function applyPdfWatermark(doc,reversible){
  if(!CFG.watermarkEnabled)return doc;
  var P=window.PDFLib,te=new TextEncoder();
  var bold=await doc.embedFont(P.StandardFonts.HelveticaBold);
  var regular=await doc.embedFont(P.StandardFonts.Helvetica);
  removePdfMark(doc);                       // never stack two marks
  doc.getPages().forEach(function(page){
    var L=markLayout(page.getSize(),bold,regular,reversible);
    var nb=String(page.node.newFontDictionary('BOMarkB',bold.ref)).replace('/','');
    var nr=String(page.node.newFontDictionary('BOMarkR',regular.ref)).replace('/','');
    var ref=doc.context.register(doc.context.stream(te.encode(markOperators(L,nb,nr))));
    contentsArray(doc,page).push(ref);
    page.node.set(P.PDFName.of(MARK_KEY),ref);
    if(L.lines.url)linkRegion(doc,page,L.x,L.y,L.boxW,L.boxH,L.lines.url);
  });
  return doc;
}

/* A Link annotation with a URI action, sized to the mark. Border width 0 so
   the mark itself is the only visible affordance. */
function linkRegion(doc,page,x,y,w,h,url){
  var P=window.PDFLib;
  var annot=doc.context.obj({Type:P.PDFName.of('Annot'),Subtype:P.PDFName.of('Link'),
    Rect:doc.context.obj([x,y,x+w,y+h]),Border:doc.context.obj([0,0,0]),
    F:4,A:doc.context.obj({Type:P.PDFName.of('Action'),S:P.PDFName.of('URI'),URI:P.PDFString.of(url)})});
  var ref=doc.context.register(annot),key=P.PDFName.of('Annots'),existing=page.node.get(key);
  if(existing&&typeof existing.push==='function')existing.push(ref);
  else page.node.set(key,doc.context.obj([ref]));
}

/* Same mark on a flattened image. No link is possible in a PNG, so the
   address is the way back. Layout is split out so the region can be cleared
   and restamped when a reversible image is made permanent. */
function canvasLayout(ctx,w,h,reversible){
  var lines=brandLines(reversible);
  var s=Math.max(.75,Math.min(2.4,Math.min(w,h)/760));
  var f1=Math.round(15*s),f2=Math.round(10*s),f3=Math.round(11.5*s);
  var pad=Math.round(11*s),barW=Math.round(27*s),barH=Math.max(3,Math.round(6*s));
  var gap=Math.round(9*s),lineGap=Math.round(9*s);
  var chipPadX=Math.round(6*s),chipPadY=Math.round(4*s);
  var B='700 '+f1+'px Arial, Helvetica, sans-serif';
  var C='700 '+f2+'px Arial, Helvetica, sans-serif';
  var U='400 '+f3+'px Arial, Helvetica, sans-serif';
  var track=TRACK*f2;
  ctx.save();ctx.textBaseline='alphabetic';
  ctx.font=B; var topW=ctx.measureText(lines.top).width;
  ctx.font=C; var chipTextW=lines.chip?ctx.measureText(lines.chip).width+track*Math.max(0,lines.chip.length-1):0;
  ctx.font=U; var urlW=lines.bottom?ctx.measureText(lines.bottom).width:0;
  ctx.restore();
  var chipW=lines.chip?Math.round(chipTextW+chipPadX*2):0;
  var chipH=lines.chip?Math.round(f2*CAP+chipPadY*2):0;
  var rowH=Math.max(chipH,Math.round(f3*CAP));
  var boxW=Math.ceil(Math.max(barW+gap+topW,(lines.chip?chipW+gap:0)+urlW)+pad*2);
  var boxH=Math.ceil(pad*2+f1*CAP+lineGap+rowH);
  return{lines:lines,s:s,f1:f1,f2:f2,f3:f3,pad:pad,barW:barW,barH:barH,gap:gap,lineGap:lineGap,
    chipW:chipW,chipH:chipH,chipPadX:chipPadX,chipPadY:chipPadY,rowH:rowH,track:track,B:B,C:C,U:U,
    boxW:boxW,boxH:boxH,x:w-boxW-Math.round(10*s),y:h-boxH-Math.round(10*s)};
}

function applyCanvasWatermark(canvas,reversible){
  if(!CFG.watermarkEnabled)return canvas;
  var ctx=canvas.getContext('2d');
  var L=canvasLayout(ctx,canvas.width,canvas.height,reversible);
  ctx.save();
  ctx.textBaseline='alphabetic';
  ctx.fillStyle='#fff';ctx.fillRect(L.x,L.y,L.boxW,L.boxH);

  // row 1 — bar centred on the cap height of the wordmark
  var base1=L.y+L.pad+L.f1*CAP;
  ctx.fillStyle='#000';
  ctx.fillRect(L.x+L.pad,Math.round(base1-L.f1*CAP/2-L.barH/2),L.barW,L.barH);
  ctx.font=L.B;ctx.fillText(L.lines.top,L.x+L.pad+L.barW+L.gap,base1);

  // row 2 — chip then address
  var rowTop=L.y+L.pad+L.f1*CAP+L.lineGap,cx=L.x+L.pad;
  if(L.lines.chip){
    var chipY=rowTop+(L.rowH-L.chipH)/2;
    ctx.strokeStyle='#000';ctx.lineWidth=Math.max(1,Math.round(1.1*L.s));
    ctx.strokeRect(cx+.5,Math.round(chipY)+.5,L.chipW,L.chipH);
    ctx.font=L.C;ctx.fillStyle='#000';
    var tx=cx+L.chipPadX,tb=chipY+(L.chipH+L.f2*CAP)/2;
    for(var i=0;i<L.lines.chip.length;i++){
      ctx.fillText(L.lines.chip[i],tx,tb);
      tx+=ctx.measureText(L.lines.chip[i]).width+L.track;
    }
    cx+=L.chipW+L.gap;
  }
  if(L.lines.bottom){
    ctx.font=L.U;ctx.fillStyle='#595959';
    ctx.fillText(L.lines.bottom,cx,rowTop+(L.rowH+L.f3*CAP)/2);
  }
  ctx.restore();
  return canvas;
}

/* An image mark lives in the pixels, so making one permanent means painting
   the region again. That is a genuine replacement, not a cover-up: a flattened
   PNG has no layer underneath, so overwriting those pixels destroys what was
   there. The same move on a PDF would only hide text, which is why the PDF
   path removes its mark stream instead. */
function restampCanvasWatermark(canvas){
  if(!CFG.watermarkEnabled)return canvas;
  var ctx=canvas.getContext('2d');
  var was=canvasLayout(ctx,canvas.width,canvas.height,true);
  var now=canvasLayout(ctx,canvas.width,canvas.height,false);
  var x=Math.min(was.x,now.x),y=Math.min(was.y,now.y);
  var w=Math.max(was.x+was.boxW,now.x+now.boxW)-x;
  var h=Math.max(was.y+was.boxH,now.y+now.boxH)-y;
  ctx.save();ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);ctx.restore();
  return applyCanvasWatermark(canvas,false);
}

/* Remove the recovery chunk and restamp, so a permanent image never carries a
   mark that still claims to be reversible. */
async function makeImagePermanent(blobOrBytes){
  var stripped=await stripPngRecovery(blobOrBytes);
  var url=URL.createObjectURL(stripped);
  try{
    var img=await new Promise(function(res,rej){
      var i=new Image();i.onload=function(){res(i);};i.onerror=rej;i.src=url;
    });
    var c=document.createElement('canvas');
    c.width=img.naturalWidth;c.height=img.naturalHeight;
    c.getContext('2d').drawImage(img,0,0);
    restampCanvasWatermark(c);
    return await new Promise(function(res,rej){
      c.toBlob(function(b){b?res(b):rej(new Error('image export failed'));},'image/png');
    });
  }finally{URL.revokeObjectURL(url);}
}

// Local-only handoff between redaction and metadata pages.
function db(){return new Promise(function(resolve,reject){var r=indexedDB.open('blackout-local',1);r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains('handoff'))r.result.createObjectStore('handoff');};r.onsuccess=function(){resolve(r.result);};r.onerror=function(){reject(r.error);};});}
async function putHandoff(item,slot){var d=await db();return new Promise(function(resolve,reject){var tx=d.transaction('handoff','readwrite');tx.objectStore('handoff').put(item,slot||'current');tx.oncomplete=function(){d.close();resolve();};tx.onerror=function(){d.close();reject(tx.error);};});}
async function getHandoff(slot){var d=await db();return new Promise(function(resolve,reject){var tx=d.transaction('handoff','readonly'),r=tx.objectStore('handoff').get(slot||'current');r.onsuccess=function(){var v=r.result||null;tx.oncomplete=function(){d.close();resolve(v);};};r.onerror=function(){d.close();reject(r.error);};});}
async function clearHandoff(slot){var d=await db();return new Promise(function(resolve,reject){var tx=d.transaction('handoff','readwrite');tx.objectStore('handoff').delete(slot||'current');tx.oncomplete=function(){d.close();resolve();};tx.onerror=function(){d.close();reject(tx.error);};});}
window.BlackoutCore={slots:true,config:CFG,generateRecoveryKey:generateRecoveryKey,isGeneratedKey:isGeneratedKey,encryptRecovery:encryptRecovery,decryptRecovery:decryptRecovery,putPngRecovery:putPngRecovery,extractPngRecovery:extractPngRecovery,attachPdfRecovery:attachPdfRecovery,extractPdfRecovery:extractPdfRecovery,applyCanvasWatermark:applyCanvasWatermark,makeImagePermanent:makeImagePermanent,removePdfMark:removePdfMark,applyPdfWatermark:applyPdfWatermark,stripPngRecovery:stripPngRecovery,stripPdfRecovery:stripPdfRecovery,hasRecoveryBytes:hasRecoveryBytes,putHandoff:putHandoff,getHandoff:getHandoff,clearHandoff:clearHandoff};
})();
