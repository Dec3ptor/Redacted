(function(){
'use strict';
var MAX_PAGES=60, pdfjsLib=window.pdfjsLib;
if(pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var $=function(id){return document.getElementById(id);};
var pages=[],history=[],selected=null,mode='box',sourceIsPDF=false,baseName='document',sourceFile=null,reversiblePayload=null,revealed=false,unlockedOriginal=null;
var drop=$('drop'),fileInput=$('file'),editor=$('editor'),pagesEl=$('pages'),statusEl=$('status'),hint=$('hint'),undoBtn=$('undoBtn'),delBtn=$('delBtn'),saveBtn=$('saveBtn');
function say(m){statusEl.textContent=m||'';}
function escRegExp(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function setMode(m){mode=m;document.body.dataset.mode=m;['Box','Text','Move'].forEach(function(n){$('mode'+n).setAttribute('aria-pressed',m===n.toLowerCase());});
 hint.textContent=m==='box'?'Drag a box over anything you want hidden.':m==='text'?'Drag across the words you want gone. Staying on one line selects only that line; drag onto other lines to take them too. Double-click covers a single word.':'Scroll normally. Tap a box to select it, then drag, resize, or delete it.';if(m!=='move')deselect();if(m!=='text')clearTextSelection();updateTextScales();}
$('modeBox').onclick=function(){setMode('box');};$('modeText').onclick=function(){if(!sourceIsPDF){say('Text selection is available for PDFs. Use Draw box for images.');return;}setMode('text');};$('modeMove').onclick=function(){setMode('move');};
function intake(file){if(!file)return;resetAll();clearTextSelection();$('resumebar').hidden=true;sourceFile=file;baseName=(file.name||'document').replace(/\.[^.]+$/,'')||'document';$('fname').textContent=file.name;sourceIsPDF=file.type==='application/pdf'||/\.pdf$/i.test(file.name);$('saveMode').style.display='flex';if(sourceIsPDF){$('searchbar').style.display='flex';say('Opening PDF…');openPDF(file);}else if((file.type||'').indexOf('image/')===0||/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)){$('searchbar').style.display='none';say('Opening image…');openImage(file);}else say('Use a PDF or image file.');}
drop.onclick=function(){fileInput.click();};drop.onkeydown=function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInput.click();}};['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('hot');});});['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('hot');});});drop.addEventListener('drop',function(e){if(e.dataTransfer.files.length)intake(e.dataTransfer.files[0]);});fileInput.onchange=function(){if(this.files.length)intake(this.files[0]);};$('newBtn').onclick=function(){fileInput.value='';resetAll();dropSession();};
function resetAll(){pages=[];history=[];selected=null;sourceFile=null;reversiblePayload=null;unlockedOriginal=null;revealed=false;pagesEl.innerHTML='';editor.style.display='none';drop.style.display='block';document.body.classList.remove('editing');undoBtn.disabled=delBtn.disabled=saveBtn.disabled=true;$('restorePanel').style.display='none';$('securebar').hidden=true;$('keyInput').value='';$('unlockKey').value='';$('unlockBtn').hidden=false;$('toggleRevealBtn').hidden=true;$('saveOriginalBtn').hidden=true;say('');}
function ready(msg){editor.style.display='block';drop.style.display='none';document.body.classList.add('editing');saveBtn.disabled=false;setMode('box');var restored=applyRestore();say(restored||msg||'');setTimeout(function(){pages.forEach(fitTextRuns);updateTextScales();},0);}
function openPDF(file){if(!pdfjsLib){say('The PDF reader did not load. Reload while connected to the internet.');return;}file.arrayBuffer().then(async function(buf){var bytes=new Uint8Array(buf);reversiblePayload=await BlackoutCore.extractPdfRecovery(bytes);if(reversiblePayload){$('restorePanel').style.display='block';$('restorePanel').querySelector('strong').textContent='This is a reversible Blackout file.';$('restoreText').textContent='Enter its recovery key to reveal the exact original PDF.';}return renderPDFBytes(bytes);}).catch(function(err){console.error(err);say('That PDF could not be opened. It may be password protected or damaged.');});}
function renderPDFBytes(bytes){return pdfjsLib.getDocument({data:bytes}).promise.then(function(pdf){var count=Math.min(pdf.numPages,MAX_PAGES),chain=Promise.resolve();for(var i=1;i<=count;i++)(function(n){chain=chain.then(function(){say('Rendering page '+n+' of '+count+'…');return pdf.getPage(n).then(function(pg){var vp=pg.getViewport({scale:2}),c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);var ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);return Promise.all([pg.render({canvasContext:ctx,viewport:vp}).promise,pg.getTextContent()]).then(function(res){addPage(c,vp.width/2,vp.height/2,n,count,makeTextItems(res[1],vp),vp.width,vp.height);});});});})(i);return chain.then(function(){ready(pdf.numPages>MAX_PAGES?'Showing the first '+MAX_PAGES+' pages. Split longer PDFs first.':(reversiblePayload?'Reversible recovery data detected.':''));});});}
/* A text item's box runs from one em above the baseline down to the baseline
   itself, so descenders — g, j, p, q, y and the tail of a Q — hang below it.
   Every box built from text geometry drops this much of an em past the bottom
   so the tails are covered too. Over-covering is the safe direction here. */
var DESCENDER=.3;
function makeTextItems(tc,vp){return (tc.items||[]).filter(function(it){return it.str&&it.str.trim();}).map(function(it){var tx=pdfjsLib.Util.transform(vp.transform,it.transform),h=Math.max(2,Math.hypot(tx[2],tx[3])||Math.abs(tx[3])||10),w=Math.max(1,(it.width||0)*vp.scale);return{str:it.str,x:tx[4],y:tx[5]-h,w:w,h:h};});}
function openImage(file){file.arrayBuffer().then(async function(buf){var bytes=new Uint8Array(buf);reversiblePayload=await BlackoutCore.extractPngRecovery(bytes);var blob=new Blob([buf],{type:file.type||'image/png'}),url=URL.createObjectURL(blob),img=new Image();img.onload=function(){var c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);addPage(c,img.naturalWidth,img.naturalHeight,1,1,[],img.naturalWidth,img.naturalHeight);if(reversiblePayload){$('restorePanel').style.display='block';$('restorePanel').querySelector('strong').textContent='This is a reversible Blackout file.';$('restoreText').textContent='Enter its recovery key to reveal the exact original file.';}ready(reversiblePayload?'Reversible recovery data detected.':'');};img.onerror=function(){URL.revokeObjectURL(url);say('That image could not be opened.');};img.src=url;}).catch(function(){say('That image could not be read.');});}
function addPage(base,wPt,hPt,num,total,textItems,intrinsicW,intrinsicH){var holder=document.createElement('div');holder.className='page';if(total>1){var lbl=document.createElement('div');lbl.className='pagenum';lbl.textContent='Page '+num+' of '+total;holder.appendChild(lbl);}var wrap=document.createElement('div');wrap.className='canvaswrap';var disp=document.createElement('canvas');disp.width=base.width;disp.height=base.height;disp.getContext('2d').drawImage(base,0,0);wrap.appendChild(disp);var textLayer=document.createElement('div');textLayer.className='textlayer';var textInner=document.createElement('div');textInner.className='textinner';textLayer.appendChild(textInner);wrap.appendChild(textLayer);var layer=document.createElement('div');layer.className='layer';var marquee=document.createElement('div');marquee.className='marquee';layer.appendChild(marquee);wrap.appendChild(layer);holder.appendChild(wrap);pagesEl.appendChild(holder);var p={base:base,redactedBase:null,unlockedBase:null,disp:disp,wrap:wrap,layer:layer,textLayer:textLayer,textInner:textInner,rects:[],wPt:wPt,hPt:hPt,textItems:textItems||[],intrinsicW:intrinsicW||base.width,intrinsicH:intrinsicH||base.height};pages.push(p);buildTextLayer(p);buildSearchIndex(p);wireDrawing(p,marquee);wireTextSelect(p);watchPageWidth(p);}
function redraw(p,canvas){p.disp.width=canvas.width;p.disp.height=canvas.height;p.disp.getContext('2d').drawImage(canvas,0,0);}
/* The invisible text has to sit exactly over the drawn glyphs, or selecting
   picks up the wrong words. A run set in the fallback font is not the width the
   PDF gives it — a Times document runs about 10% wide, which is most of a word
   adrift by the end of a line — so each run is measured once and squeezed onto
   its real width. Measuring happens with the layer's own scale off, so the
   numbers are in page units. */
function buildTextLayer(p){
  p.textInner.style.transform='none';
  p.textInner.style.width=p.intrinsicW+'px';
  p.textInner.style.height=p.intrinsicH+'px';
  p.textRuns=[];
  p.textItems.forEach(function(it){
    var s=document.createElement('span');
    s.textContent=it.str;
    s.style.left=it.x+'px';
    s.style.top=it.y+'px';
    s.style.fontSize=Math.max(2,it.h)+'px';
    p.textInner.appendChild(s);
    p.textRuns.push({el:s,want:Math.max(1,it.w)});
  });
}

/* Measuring only works once the editor is on screen — pages are built while it
   is still display:none, where every rect comes back zero. Run once, then the
   ratios hold however the page is later scaled. */
function fitTextRuns(p){
  if(!p.textRuns||p.fitted)return;
  if(!p.wrap.clientWidth)return;
  p.textInner.style.transform='none';
  p.textRuns.forEach(function(r){
    var rg=document.createRange();rg.selectNodeContents(r.el);
    var got=rg.getBoundingClientRect().width;
    if(got>0)r.el.style.transform='scaleX('+(r.want/got)+')';
  });
  p.fitted=true;
  syncTextScale(p);
}
function syncTextScale(p){
  if(!p.textInner||!p.intrinsicW)return;
  var w=p.wrap.clientWidth;
  if(w)p.textInner.style.transform='scale('+(w/p.intrinsicW)+')';
}
function updateTextScales(){pages.forEach(function(p){fitTextRuns(p);syncTextScale(p);});}
window.addEventListener('resize',updateTextScales);
/* window resize is not the only thing that changes the canvas width — the
   toolbar rewrapping, fonts arriving and a phone's address bar collapsing all
   do, and a stale scale slides the invisible text off the page. */
function watchPageWidth(p){
  if(!window.ResizeObserver)return;
  p.ro=new ResizeObserver(function(){syncTextScale(p);});
  p.ro.observe(p.wrap);
}
function buildSearchIndex(p){var text='',ranges=[];p.textItems.forEach(function(it){if(text&&/\S$/.test(text)&&/^\S/.test(it.str))text+=' ';var start=text.length;text+=it.str;ranges.push({start:start,end:text.length,item:it});});p.searchText=text;p.searchRanges=ranges;}
function snapshot(){history.push(pages.map(function(p){return p.rects.map(function(r){return{x:r.x,y:r.y,w:r.w,h:r.h};});}));if(history.length>80)history.shift();undoBtn.disabled=false;}
undoBtn.onclick=function(){var snap=history.pop();if(!snap)return;deselect();pages.forEach(function(p,i){p.rects.forEach(function(r){r.el.remove();});p.rects=[];(snap[i]||[]).forEach(function(d){makeBox(p,d.x,d.y,d.w,d.h);});});undoBtn.disabled=!history.length;};
function makeBox(page,x,y,w,h){x=Math.max(0,Math.min(x,1));y=Math.max(0,Math.min(y,1));w=Math.max(.002,Math.min(w,1-x));h=Math.max(.002,Math.min(h,1-y));var el=document.createElement('div');el.className='rbox';var del=document.createElement('button');del.type='button';del.className='rdel';del.setAttribute('aria-label','Delete this box');del.textContent='×';var grip=document.createElement('span');grip.className='rgrip';el.appendChild(del);el.appendChild(grip);page.layer.appendChild(el);var r={x:x,y:y,w:w,h:h,el:el,page:page};place(r);page.rects.push(r);wireBox(r,del,grip);return r;}
function place(r){r.el.style.left=r.x*100+'%';r.el.style.top=r.y*100+'%';r.el.style.width=r.w*100+'%';r.el.style.height=r.h*100+'%';}
function select(r){deselect();selected=r;r.el.classList.add('sel');delBtn.disabled=false;}function deselect(){if(selected)selected.el.classList.remove('sel');selected=null;delBtn.disabled=true;}
function removeBox(r){var i=r.page.rects.indexOf(r);if(i>-1)r.page.rects.splice(i,1);r.el.remove();if(selected===r)deselect();}
delBtn.onclick=function(){if(selected){snapshot();removeBox(selected);}};document.addEventListener('keydown',function(e){if(!selected)return;if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();snapshot();removeBox(selected);}else if(e.key==='Escape')deselect();});
function wireDrawing(page,marquee){var drawing=false,sx=0,sy=0,wrap=page.wrap;function rel(e){var b=wrap.getBoundingClientRect();return{x:Math.min(Math.max((e.clientX-b.left)/b.width,0),1),y:Math.min(Math.max((e.clientY-b.top)/b.height,0),1)};}wrap.addEventListener('pointerdown',function(e){if(mode!=='box')return;e.preventDefault();wrap.setPointerCapture(e.pointerId);drawing=true;var p=rel(e);sx=p.x;sy=p.y;marquee.style.display='block';marquee.style.left=sx*100+'%';marquee.style.top=sy*100+'%';marquee.style.width='0';marquee.style.height='0';});wrap.addEventListener('pointermove',function(e){if(!drawing)return;var p=rel(e);marquee.style.left=Math.min(sx,p.x)*100+'%';marquee.style.top=Math.min(sy,p.y)*100+'%';marquee.style.width=Math.abs(p.x-sx)*100+'%';marquee.style.height=Math.abs(p.y-sy)*100+'%';});function done(e){if(!drawing)return;drawing=false;marquee.style.display='none';var p=rel(e),w=Math.abs(p.x-sx),h=Math.abs(p.y-sy);if(w<.005||h<.005)return;snapshot();makeBox(page,Math.min(sx,p.x),Math.min(sy,p.y),w,h);}wrap.addEventListener('pointerup',done);wrap.addEventListener('pointercancel',function(){drawing=false;marquee.style.display='none';});}
/* ============================================================
   Selecting text to redact.

   The browser's own selection is no use over a PDF. The text sits in
   absolutely positioned runs whose DOM order is the order the PDF happens to
   draw them in, not the order they appear on the page, so the moment the
   pointer leaves a line the browser extends the selection through DOM order
   and swallows half the document. Nudging the mouse a few pixels above a line
   should not do that.

   So selection here is geometric and knows nothing about the DOM. Words are
   measured once, grouped into lines, and a drag picks the run of words between
   where it started and where it is now. Staying on one line can only ever
   select on that line; other lines are reached by actually being over them.
   ============================================================ */

/* Words, measured once per page and cached, in fractions of the page so they
   survive any later rescaling. */
function wordIndex(p){
  if(p.words)return p.words;
  if(!p.textInner||!p.wrap.clientWidth)return null;
  fitTextRuns(p);
  var canvas=p.disp.getBoundingClientRect();
  if(!canvas.width||!canvas.height)return null;

  var words=[];
  [].forEach.call(p.textInner.childNodes,function(span){
    var node=span.firstChild;
    if(!node||!node.nodeValue)return;
    var re=/\S+/g,m;
    while((m=re.exec(node.nodeValue))){
      var rg=document.createRange();
      rg.setStart(node,m.index);
      rg.setEnd(node,m.index+m[0].length);
      var r=rg.getBoundingClientRect();
      if(r.width<=0||r.height<=0)continue;
      words.push({
        x1:(r.left-canvas.left)/canvas.width,
        x2:(r.right-canvas.left)/canvas.width,
        y1:(r.top-canvas.top)/canvas.height,
        y2:(r.bottom-canvas.top)/canvas.height
      });
    }
  });
  if(!words.length){p.words={lines:[],all:[]};return p.words;}

  // group into lines by vertical overlap, then read each line left to right
  words.sort(function(a,b){return (a.y1+a.y2)/2-(b.y1+b.y2)/2;});
  var lines=[],cur=null;
  words.forEach(function(w){
    var mid=(w.y1+w.y2)/2;
    if(cur&&mid<cur.y2-(cur.y2-cur.y1)*.35){cur.words.push(w);cur.y1=Math.min(cur.y1,w.y1);cur.y2=Math.max(cur.y2,w.y2);}
    else{cur={y1:w.y1,y2:w.y2,words:[w]};lines.push(cur);}
  });
  var all=[];
  lines.forEach(function(line,li){
    line.words.sort(function(a,b){return a.x1-b.x1;});
    line.index=li;
    line.words.forEach(function(w){w.line=li;w.i=all.length;all.push(w);});
  });
  p.words={lines:lines,all:all};
  return p.words;
}

/* Which word is under a point — or, if none is, the nearest one on the line
   the point is closest to. Falling into the gap between two lines picks a
   neighbour rather than doing something dramatic. */
function wordNear(idx,x,y){
  if(!idx||!idx.lines.length)return null;
  var line=null,best=Infinity;
  idx.lines.forEach(function(l){
    var d=y<l.y1?l.y1-y:(y>l.y2?y-l.y2:0);
    if(d<best){best=d;line=l;}
  });
  if(!line)return null;
  var pick=null,pd=Infinity;
  line.words.forEach(function(w){
    var d=x<w.x1?w.x1-x:(x>w.x2?x-w.x2:0);
    if(d<pd){pd=d;pick=w;}
  });
  return pick;
}

/* One merged bar per line for everything between two words. */
function spanBoxes(idx,a,b){
  if(!a||!b)return[];
  var lo=Math.min(a.i,b.i),hi=Math.max(a.i,b.i),byLine={};
  for(var i=lo;i<=hi;i++){
    var w=idx.all[i],g=byLine[w.line];
    if(!g)byLine[w.line]=g={x1:w.x1,x2:w.x2,y1:w.y1,y2:w.y2};
    else{g.x1=Math.min(g.x1,w.x1);g.x2=Math.max(g.x2,w.x2);g.y1=Math.min(g.y1,w.y1);g.y2=Math.max(g.y2,w.y2);}
  }
  var out=[];
  Object.keys(byLine).forEach(function(k){
    var g=byLine[k],padX=.002,padTop=(g.y2-g.y1)*.12,drop=(g.y2-g.y1)*DESCENDER;
    var x=Math.max(0,g.x1-padX),y=Math.max(0,g.y1-padTop);
    out.push({x:x,y:y,
      w:Math.min(1-x,g.x2+padX-x),
      h:Math.min(1-y,g.y2+drop-y)});
  });
  return out;
}

function clearHighlight(page){
  if(!page||!page.hl)return;
  page.hl.forEach(function(el){el.remove();});
  page.hl=null;
}

function drawHighlight(page,boxes){
  clearHighlight(page);
  page.hl=boxes.map(function(b){
    var el=document.createElement('div');
    el.className='selhl';
    el.style.left=b.x*100+'%';el.style.top=b.y*100+'%';
    el.style.width=b.w*100+'%';el.style.height=b.h*100+'%';
    page.layer.appendChild(el);
    return el;
  });
}

function wireTextSelect(page){
  var wrap=page.wrap,idx=null,anchor=null,head=null,dragging=false,moved=false,startX=0,startY=0;

  function at(e){
    var b=page.disp.getBoundingClientRect();
    return{x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height};
  }
  function paint(){
    if(!anchor||!head)return;
    drawHighlight(page,spanBoxes(idx,anchor,head));
  }

  wrap.addEventListener('pointerdown',function(e){
    if(mode!=='text'||e.button)return;
    idx=wordIndex(page);
    if(!idx||!idx.all.length)return;
    var p=at(e);
    anchor=wordNear(idx,p.x,p.y);
    head=anchor;
    if(!anchor)return;
    dragging=true;moved=false;startX=e.clientX;startY=e.clientY;
    try{wrap.setPointerCapture(e.pointerId);}catch(err){}
    e.preventDefault();
    paint();
  });

  wrap.addEventListener('pointermove',function(e){
    if(!dragging)return;
    if(!moved&&Math.abs(e.clientX-startX)<3&&Math.abs(e.clientY-startY)<3)return;
    moved=true;
    var p=at(e);
    var w=wordNear(idx,p.x,p.y);
    if(w){head=w;paint();}
  });

  function finish(e){
    if(!dragging)return;
    dragging=false;
    try{wrap.releasePointerCapture(e.pointerId);}catch(err){}
    var boxes=(anchor&&head)?spanBoxes(idx,anchor,head):[];
    clearHighlight(page);
    anchor=head=null;
    if(!boxes.length)return;
    if(!moved)return;   // a click is not a selection; double-click takes the word
    snapshot();
    boxes.forEach(function(b){makeBox(page,b.x,b.y,b.w,b.h);});
    say('Blacked out '+boxes.length+' line'+(boxes.length===1?'':'s')+'. Undo if that caught too much.');
  }
  wrap.addEventListener('pointerup',finish);
  wrap.addEventListener('pointercancel',function(e){
    dragging=false;clearHighlight(page);anchor=head=null;
    try{wrap.releasePointerCapture(e.pointerId);}catch(err){}
  });

  // a double click takes the word under the pointer
  wrap.addEventListener('dblclick',function(e){
    if(mode!=='text')return;
    idx=wordIndex(page);
    if(!idx||!idx.all.length)return;
    var p=at(e),w=wordNear(idx,p.x,p.y);
    if(!w)return;
    var boxes=spanBoxes(idx,w,w);
    if(!boxes.length)return;
    snapshot();
    boxes.forEach(function(b){makeBox(page,b.x,b.y,b.w,b.h);});
    say('Blacked out one word. Undo if that caught too much.');
  });
}

function clearTextSelection(){
  pages.forEach(clearHighlight);
  var s=window.getSelection();
  if(s&&s.rangeCount)s.removeAllRanges();
}

function wireBox(r,del,grip){var dragging=false,resizing=false,moved=false,startX=0,startY=0,origin=null;function scale(){var b=r.page.wrap.getBoundingClientRect();return{w:b.width,h:b.height};}del.onpointerdown=function(e){e.stopPropagation();};del.onclick=function(e){e.stopPropagation();snapshot();removeBox(r);};grip.addEventListener('pointerdown',function(e){if(mode!=='move')return;e.stopPropagation();e.preventDefault();grip.setPointerCapture(e.pointerId);select(r);resizing=true;moved=false;startX=e.clientX;startY=e.clientY;origin={w:r.w,h:r.h};});grip.addEventListener('pointermove',function(e){if(!resizing)return;if(!moved){snapshot();moved=true;}var s=scale();r.w=Math.max(.005,Math.min(origin.w+(e.clientX-startX)/s.w,1-r.x));r.h=Math.max(.005,Math.min(origin.h+(e.clientY-startY)/s.h,1-r.y));place(r);});grip.onpointerup=grip.onpointercancel=function(){resizing=false;};r.el.addEventListener('pointerdown',function(e){if(mode!=='move')return;e.preventDefault();r.el.setPointerCapture(e.pointerId);select(r);dragging=true;moved=false;startX=e.clientX;startY=e.clientY;origin={x:r.x,y:r.y};});r.el.addEventListener('pointermove',function(e){if(!dragging)return;var dx=e.clientX-startX,dy=e.clientY-startY;if(!moved){if(Math.abs(dx)<3&&Math.abs(dy)<3)return;snapshot();moved=true;}var s=scale();r.x=Math.max(0,Math.min(origin.x+dx/s.w,1-r.w));r.y=Math.max(0,Math.min(origin.y+dy/s.h,1-r.h));place(r);});r.el.onpointerup=r.el.onpointercancel=function(){dragging=false;};}
function boxesForMatch(page,start,end){var its=page.searchRanges.filter(function(r){return r.end>start&&r.start<end;}).map(function(r){return r.item;});if(!its.length)return[];var groups=[];its.forEach(function(it){var cy=it.y+it.h/2,g=groups.length?groups[groups.length-1]:null;if(!g||Math.abs(cy-g.cy)>Math.max(it.h,g.h)*.7){g={x1:it.x,y1:it.y,x2:it.x+it.w,y2:it.y+it.h,cy:cy,h:it.h};groups.push(g);}else{g.x1=Math.min(g.x1,it.x);g.y1=Math.min(g.y1,it.y);g.x2=Math.max(g.x2,it.x+it.w);g.y2=Math.max(g.y2,it.y+it.h);g.cy=(g.y1+g.y2)/2;g.h=g.y2-g.y1;}});return groups.map(function(g){var padX=Math.max(3,g.h*.1),padTop=Math.max(2,g.h*.08),padBot=Math.max(3,g.h*DESCENDER),x1=Math.max(0,g.x1-padX),y1=Math.max(0,g.y1-padTop),x2=Math.min(page.intrinsicW,g.x2+padX),y2=Math.min(page.intrinsicH,g.y2+padBot);return{x:x1/page.intrinsicW,y:y1/page.intrinsicH,w:(x2-x1)/page.intrinsicW,h:(y2-y1)/page.intrinsicH};});}
function redactMatches(pattern,label){var found=[];pages.forEach(function(p){var m;pattern.lastIndex=0;while((m=pattern.exec(p.searchText))){if(m[0].length===0){pattern.lastIndex++;continue;}found.push({page:p,start:m.index,end:m.index+m[0].length,text:m[0],label:label});}});if(!found.length)return 0;snapshot();var n=0;found.forEach(function(f){boxesForMatch(f.page,f.start,f.end).forEach(function(b){makeBox(f.page,b.x,b.y,b.w,b.h);n++;});});return n;}
$('searchBtn').onclick=function(){var q=$('searchInput').value;if(!q.trim()){say('Enter text to search for first.');return;}var flags=$('matchCase').checked?'g':'gi',n=redactMatches(new RegExp(escRegExp(q),flags),'search');say(n?('Added '+n+' box'+(n===1?'':'es')+' for “'+q+'”. Review them before saving.'):'No matching text was found.');};
function luhnLike(s){var d=s.replace(/\D/g,'');if(d.length<13||d.length>19)return false;var sum=0,alt=false;for(var i=d.length-1;i>=0;i--){var n=+d[i];if(alt){n*=2;if(n>9)n-=9;}sum+=n;alt=!alt;}return sum%10===0;}
var MONTHS='jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
function digitsIn(s){return s.replace(/\D/g,'').length;}
/* Ordered most specific first. On overlap the earlier detector wins, so a card
   number is never counted as a phone number and nothing is boxed twice. */
var SMART_PATTERNS=[
{name:'email',re:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi},
{name:'payment card',re:/\b(?:\d[ -]*?){13,19}\b/g,ok:luhnLike},
{name:'IBAN',re:/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{2,4}){2,8}\b/gi},
{name:'NZ bank account',re:/\b\d{2}[- ]?\d{4}[- ]?\d{7}[- ]?\d{2,3}\b/g},
{name:'social security number',re:/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g},
{name:'IP address',re:/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,ok:function(s){return s.split('.').every(function(o){return +o<=255;});}},
{name:'coordinate pair',re:/[-+]?\d{1,3}\.\d{4,}\s*[,;]\s*[-+]?\d{1,3}\.\d{4,}/g},
{name:'date',re:new RegExp('\\b(?:\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4}|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\s+(?:'+MONTHS+')\\.?,?\\s+\\d{2,4}|(?:'+MONTHS+')\\.?\\s+\\d{1,2},?\\s+\\d{2,4})\\b','gi')},
{name:'phone number',re:/(?:\+?\d[\d\s().-]{7,}\d)/g,ok:function(s){var d=digitsIn(s);return d>=8&&d<=15;}}
];
function countLabel(n,l){return n+' '+l+(n===1?'':(/(?:s|x|ch|sh)$/i.test(l)?'es':'s'));}
$('smartBtn').onclick=function(){var matches=[];pages.forEach(function(p){var found=[];SMART_PATTERNS.forEach(function(pt,rank){pt.re.lastIndex=0;var m;while((m=pt.re.exec(p.searchText))){if(!m[0].length){pt.re.lastIndex++;continue;}if(pt.ok&&!pt.ok(m[0]))continue;found.push({start:m.index,end:m.index+m[0].length,rank:rank,label:pt.name});}});found.sort(function(a,b){return a.rank-b.rank||a.start-b.start||(b.end-b.start)-(a.end-a.start);});var kept=[];found.forEach(function(f){for(var i=0;i<kept.length;i++)if(f.start<kept[i].end&&kept[i].start<f.end)return;kept.push(f);});kept.forEach(function(f){matches.push({page:p,start:f.start,end:f.end,label:f.label});});});if(!matches.length){say('Smart scan found no common sensitive patterns. Names and addresses still need manual review.');return;}snapshot();var n=0,counts={},order=[];matches.forEach(function(f){if(counts[f.label]===undefined){counts[f.label]=0;order.push(f.label);}counts[f.label]++;boxesForMatch(f.page,f.start,f.end).forEach(function(b){makeBox(f.page,b.x,b.y,b.w,b.h);n++;});});order.sort(function(a,b){return counts[b]-counts[a];});say('Smart scan added '+n+' boxes: '+order.map(function(k){return countLabel(counts[k],k);}).join(', ')+'. Review every result before saving.');};
function flatten(page){var c=document.createElement('canvas');c.width=page.base.width;c.height=page.base.height;var ctx=c.getContext('2d');ctx.drawImage(page.base,0,0);ctx.fillStyle='#000';page.rects.forEach(function(r){ctx.fillRect(Math.round(r.x*c.width),Math.round(r.y*c.height),Math.round(r.w*c.width),Math.round(r.h*c.height));});return c;}
/* The redaction step hands a flattened file to metadata review and leaves the
   editor behind. Keeping the source file and the boxes lets Back to editing
   put the session back exactly as it was. The recovery key is deliberately not
   kept — storing it beside the encrypted payload would defeat the encryption. */
var pendingRestore=null;
function slotsOK(){return !!(window.BlackoutCore&&BlackoutCore.slots);}
async function keepSession(){
  if(!sourceFile||!slotsOK())return;   // an older core would write it over the handoff
  try{await BlackoutCore.putHandoff({file:sourceFile,name:sourceFile.name,mode:selectedOutput(),
    rects:pages.map(function(p){return p.rects.map(function(r){return{x:r.x,y:r.y,w:r.w,h:r.h};});}),
    savedAt:Date.now()},'session');}
  catch(e){console.error(e);}          // losing the session must never block the save
}
async function dropSession(){try{await BlackoutCore.clearHandoff('session');}catch(e){}}
function restoreSession(s){if(!s||!s.file)return false;pendingRestore=s;intake(s.file);return true;}
function applyRestore(){
  if(!pendingRestore)return'';
  var s=pendingRestore;pendingRestore=null;var n=0;
  (s.rects||[]).forEach(function(list,i){var p=pages[i];if(!p)return;list.forEach(function(b){makeBox(p,b.x,b.y,b.w,b.h);n++;});});
  if(s.mode==='reversible'){var el=document.querySelector('input[name="outputMode"][value="reversible"]');
    if(el){el.checked=true;$('securebar').hidden=false;}}
  return 'Back in the editor with '+n+' box'+(n===1?'':'es')+' restored.'+
    (s.mode==='reversible'?' Re-enter or generate your recovery key — it is never stored.':'');
}
function selectedOutput(){var el=document.querySelector('input[name="outputMode"]:checked');return el?el.value:'permanent';}
document.querySelectorAll('input[name="outputMode"]').forEach(function(r){r.addEventListener('change',function(){var rev=selectedOutput()==='reversible';$('securebar').hidden=!rev;if(rev&&!$('keyInput').value){$('keyInput').value=BlackoutCore.generateRecoveryKey();$('keyInput').type='text';$('showKeyBtn').textContent='Hide';say('A 256-bit recovery key was generated. Store it separately from the redacted file.');}});});
$('genKeyBtn').onclick=function(){$('keyInput').value=BlackoutCore.generateRecoveryKey();$('keyInput').type='text';$('showKeyBtn').textContent='Hide';say('Generated a new 256-bit recovery key. Store it separately.');};$('showKeyBtn').onclick=function(){var i=$('keyInput');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide';};
async function requestHandle(name,mime){if(!window.showSaveFilePicker)return undefined;try{return await window.showSaveFilePicker({suggestedName:name,types:[{description:mime==='application/pdf'?'PDF document':'PNG image',accept:{[mime]:[mime==='application/pdf'?'.pdf':'.png']}}]});}catch(e){if(e&&e.name==='AbortError')return null;console.warn(e);return undefined;}}
async function deliver(blob,name,handle){if(handle){var w=await handle.createWritable();await w.write(blob);await w.close();return 'Saved to the location you chose.';}var a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},5000);return 'Saved using your browser download flow.';}
saveBtn.onclick=async function(){if(!pages.length)return;var total=pages.reduce(function(n,p){return n+p.rects.length;},0);if(!total&&!window.confirm('You have not marked anything yet. Continue anyway?'))return;var reversible=selectedOutput()==='reversible',key=$('keyInput').value;if(reversible&&!key){key=BlackoutCore.generateRecoveryKey();$('keyInput').value=key;$('keyInput').type='text';$('showKeyBtn').textContent='Hide';$('securebar').hidden=false;say('A recovery key was generated. Copy it somewhere safe, then continue again.');return;}if(reversible&&!BlackoutCore.isGeneratedKey(key)&&key.length<20){say('For a custom recovery secret, use at least 20 characters. The generated 256-bit BO2 key is strongly recommended.');$('securebar').hidden=false;return;}deselect();saveBtn.disabled=true;say('Creating redacted file…');try{var blob,mime=sourceIsPDF?'application/pdf':'image/png',name=baseName+(reversible?'-redacted-reversible': '-redacted')+(sourceIsPDF?'.pdf':'.png');if(sourceIsPDF){var jsPDF=window.jspdf.jsPDF,doc=null;pages.forEach(function(p,i){var data=flatten(p).toDataURL('image/jpeg',.92),fmt=[p.wPt,p.hPt],ori=p.wPt>p.hPt?'landscape':'portrait';if(i===0)doc=new jsPDF({unit:'pt',format:fmt,orientation:ori});else doc.addPage(fmt,ori);doc.addImage(data,'JPEG',0,0,p.wPt,p.hPt);});blob=doc.output('blob');}else blob=await canvasBlob(flatten(pages[0]),'image/png');if(reversible){say('Encrypting exact original…');var originalBytes=new Uint8Array(await sourceFile.arrayBuffer()),meta={originalName:sourceFile.name||baseName,originalMime:sourceFile.type||(sourceIsPDF?'application/pdf':'application/octet-stream'),sourceKind:sourceIsPDF?'pdf':'image',created:new Date().toISOString(),rects:pages.map(function(p){return p.rects.map(function(r){return{x:r.x,y:r.y,w:r.w,h:r.h};});}),cryptoAgility:{format:'Blackout Recovery v2',payload:'exact-original-file'}};var envelope=await BlackoutCore.encryptRecovery(originalBytes,key,meta);if(sourceIsPDF){var pdfWithRecovery=await BlackoutCore.attachPdfRecovery(new Uint8Array(await blob.arrayBuffer()),envelope);blob=new Blob([pdfWithRecovery],{type:'application/pdf'});}else blob=await BlackoutCore.putPngRecovery(blob,envelope);}say('Passing the redacted file to metadata review…');await keepSession();await BlackoutCore.putHandoff({blob:blob,name:name,mime:mime,reversible:reversible,createdAt:Date.now()});location.href='metadata.html?handoff=1';}catch(err){console.error(err);say('Could not continue to metadata. The browser may be out of local storage; try a smaller file or close other tabs.');saveBtn.disabled=false;}};
function canvasBlob(c,type){return new Promise(function(resolve,reject){c.toBlob(function(b){b?resolve(b):reject(new Error('Canvas export failed'));},type||'image/png');});}
async function imageCanvasFromBytes(bytes,mime){return new Promise(function(resolve,reject){var url=URL.createObjectURL(new Blob([bytes],{type:mime||'image/png'})),img=new Image();img.onload=function(){var c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);resolve(c);};img.onerror=function(){URL.revokeObjectURL(url);reject(new Error('Could not render original image'));};img.src=url;});}
async function pdfCanvasesFromBytes(bytes){var pdf=await pdfjsLib.getDocument({data:bytes.slice()}).promise,out=[];for(var n=1;n<=Math.min(pdf.numPages,pages.length);n++){var pg=await pdf.getPage(n),vp=pg.getViewport({scale:2}),c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;out.push(c);}return out;}
$('unlockBtn').onclick=async function(){if(!reversiblePayload){say('No reversible recovery data is loaded.');return;}var key=$('unlockKey').value;if(!key){say('Enter the recovery key.');return;}try{say('Decrypting exact original…');unlockedOriginal=await BlackoutCore.decryptRecovery(reversiblePayload,key);var mime=unlockedOriginal.meta.originalMime||'application/octet-stream';if(mime==='application/pdf'||unlockedOriginal.meta.sourceKind==='pdf'){var cs=await pdfCanvasesFromBytes(unlockedOriginal.bytes);pages.forEach(function(p,i){if(!cs[i])return;p.redactedBase=p.base;p.unlockedBase=cs[i];});}else{var c=await imageCanvasFromBytes(unlockedOriginal.bytes,mime);pages[0].redactedBase=pages[0].base;pages[0].unlockedBase=c;}revealed=true;pages.forEach(function(p){if(p.unlockedBase){p.base=p.unlockedBase;redraw(p,p.base);}});$('unlockBtn').hidden=true;$('toggleRevealBtn').hidden=false;$('saveOriginalBtn').hidden=false;$('toggleRevealBtn').textContent='Show redacted';$('saveOriginalBtn').textContent='Save exact original';say('Key accepted. The exact original is visible in this browser session.');}catch(err){console.error(err);say('That key could not decrypt this Blackout file.');}};
$('toggleRevealBtn').onclick=function(){if(!unlockedOriginal)return;revealed=!revealed;pages.forEach(function(p){if(!p.unlockedBase||!p.redactedBase)return;p.base=revealed?p.unlockedBase:p.redactedBase;redraw(p,p.base);});this.textContent=revealed?'Show redacted':'Reveal original';};
$('saveOriginalBtn').onclick=async function(){if(!unlockedOriginal)return;var mime=unlockedOriginal.meta.originalMime||'application/octet-stream',name=unlockedOriginal.meta.originalName||'restored-original',handle=await requestHandle(name,mime==='application/pdf'?'application/pdf':(mime.indexOf('image/')===0?'image/png':'application/octet-stream'));if(handle===null)return;var blob=new Blob([unlockedOriginal.bytes],{type:mime});say(await deliver(blob,name,handle));};
$('resumeBtn').onclick=async function(){var s=null;try{s=await BlackoutCore.getHandoff('session');}catch(e){}
  $('resumebar').hidden=true;
  if(s&&s.file)restoreSession(s);else say('That unfinished edit is no longer available.');};
$('discardBtn').onclick=async function(){$('resumebar').hidden=true;await dropSession();say('Unfinished edit discarded.');};
(async function(){
  var wantsResume=new URLSearchParams(location.search).get('resume')==='1',s=null;
  try{if(slotsOK())s=await BlackoutCore.getHandoff('session');}catch(e){}
  if(!s||!s.file){if(wantsResume)say(slotsOK()?'That unfinished edit is no longer available. Open the file again to start over.':'This page is running a cached older copy of one of its scripts, so the edit could not be restored. Reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac) and redact the file again.');return;}
  if(wantsResume){window.history.replaceState(null,'','index.html');restoreSession(s);return;}
  $('resumeText').textContent='Unfinished edit of \u201C'+(s.name||'a file')+'\u201D.';
  $('resumebar').hidden=false;
})();
setMode('box');
})();
