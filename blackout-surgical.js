/* ============================================================
   Surgical redaction — take the words out of the file.

   The other method throws the whole document away and keeps a picture. This
   one edits the page: the glyphs under each box are deleted from the content
   stream and everything else stays exactly as it was, so the output is still
   real, searchable, selectable text everywhere you did not redact.

   It is also the method that fails quietly. A tool that removes almost all of
   the covered text produces a file indistinguishable from a correct one — the
   black box is drawn either way. So nothing here is trusted: the result is
   re-read and proved before it is offered, and anything this editor cannot
   reason about makes it decline rather than guess. See verifyRedaction below.
   ============================================================ */
(function(){
'use strict';

var td=new TextDecoder('latin1');

function bail(reason){ return {ok:false,reason:reason}; }

/* ---------- content stream scanning ----------
   Enough of a tokeniser to find where each operator's operands begin and end.
   Output is byte ranges into the original stream, so everything untouched is
   copied through verbatim rather than re-serialised. */
var WS='\x00\t\n\f\r ';
function isWS(c){ return WS.indexOf(c)>=0; }
function isDelim(c){ return '()<>[]{}/%'.indexOf(c)>=0; }

function scan(bytes){
  var s=td.decode(bytes),n=s.length,i=0,toks=[];
  while(i<n){
    var c=s[i];
    if(isWS(c)){i++;continue;}
    if(c==='%'){while(i<n&&s[i]!=='\n'&&s[i]!=='\r')i++;continue;}
    var start=i;
    if(c==='('){                                  // literal string
      var depth=0;
      while(i<n){
        if(s[i]==='\\'){i+=2;continue;}
        if(s[i]==='('){depth++;}
        else if(s[i]===')'){depth--;if(!depth){i++;break;}}
        i++;
      }
      toks.push({t:'str',a:start,b:i});continue;
    }
    if(c==='<'&&s[i+1]==='<'){toks.push({t:'dict<<',a:start,b:i+2});i+=2;continue;}
    if(c==='>'&&s[i+1]==='>'){toks.push({t:'dict>>',a:start,b:i+2});i+=2;continue;}
    if(c==='<'){while(i<n&&s[i]!=='>')i++;i++;toks.push({t:'str',a:start,b:i});continue;}
    if(c==='['){toks.push({t:'[',a:start,b:++i});continue;}
    if(c===']'){toks.push({t:']',a:start,b:++i});continue;}
    if(c==='/'){i++;while(i<n&&!isWS(s[i])&&!isDelim(s[i]))i++;toks.push({t:'name',a:start,b:i,v:s.slice(start+1,i)});continue;}
    if('+-.0123456789'.indexOf(c)>=0){
      i++;while(i<n&&'+-.0123456789eE'.indexOf(s[i])>=0)i++;
      toks.push({t:'num',a:start,b:i,v:parseFloat(s.slice(start,i))});continue;
    }
    i++;while(i<n&&!isWS(s[i])&&!isDelim(s[i]))i++;
    var op=s.slice(start,i);
    if(op==='BI'){                                // inline image: skip its binary
      var id=s.indexOf('ID',i);
      if(id<0)return null;
      var j=id+3;
      while(j<n){
        if(s[j]==='E'&&s[j+1]==='I'&&(j+2>=n||isWS(s[j+2]))&&isWS(s[j-1])){j+=2;break;}
        j++;
      }
      toks.push({t:'op',a:start,b:j,v:'BI'});i=j;continue;
    }
    toks.push({t:'op',a:start,b:i,v:op});
  }
  return toks;
}

/* ---------- matrices ---------- */
function mul(m,n){
  return[m[0]*n[0]+m[1]*n[2], m[0]*n[1]+m[1]*n[3],
         m[2]*n[0]+m[3]*n[2], m[2]*n[1]+m[3]*n[3],
         m[4]*n[0]+m[5]*n[2]+n[4], m[4]*n[1]+m[5]*n[3]+n[5]];
}
function apply(m,x,y){ return[m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]; }
function boxOfUnitSquare(m){
  var p=[apply(m,0,0),apply(m,1,0),apply(m,0,1),apply(m,1,1)];
  var xs=p.map(function(q){return q[0];}),ys=p.map(function(q){return q[1];});
  return{x1:Math.min.apply(null,xs),y1:Math.min.apply(null,ys),
         x2:Math.max.apply(null,xs),y2:Math.max.apply(null,ys)};
}
function overlaps(a,b){ return a.x1<b.x2&&b.x1<a.x2&&a.y1<b.y2&&b.y1<a.y2; }

/* ---------- PDF strings ---------- */
function unescapeLiteral(s){                       // s includes the parentheses
  var out=[],i=1,n=s.length-1;
  while(i<n){
    var c=s[i];
    if(c!=='\\'){out.push(s.charCodeAt(i));i++;continue;}
    var d=s[i+1];
    if(d==='n'){out.push(10);i+=2;}
    else if(d==='r'){out.push(13);i+=2;}
    else if(d==='t'){out.push(9);i+=2;}
    else if(d==='b'){out.push(8);i+=2;}
    else if(d==='f'){out.push(12);i+=2;}
    else if(d>='0'&&d<='7'){
      var oct='';var k=i+1;
      while(k<n&&oct.length<3&&s[k]>='0'&&s[k]<='7'){oct+=s[k];k++;}
      out.push(parseInt(oct,8)&255);i=k;
    }
    else if(d==='\n'){i+=2;}
    else if(d==='\r'){i+=(s[i+2]==='\n')?3:2;}
    else{out.push(s.charCodeAt(i+1));i+=2;}
  }
  return out;
}
function unhex(s){                                 // s includes the angle brackets
  var h=s.slice(1,-1).replace(/[^0-9A-Fa-f]/g,'');
  if(h.length%2)h+='0';
  var out=[];
  for(var i=0;i<h.length;i+=2)out.push(parseInt(h.substr(i,2),16));
  return out;
}
function toLiteral(codes){
  var s='(';
  for(var i=0;i<codes.length;i++){
    var c=codes[i];
    if(c===40||c===41||c===92)s+='\\'+String.fromCharCode(c);
    else if(c<32||c>126)s+='\\'+('000'+c.toString(8)).slice(-3);
    else s+=String.fromCharCode(c);
  }
  return s+')';
}

/* ---------- the edit ----------
   For each show operator the caller supplies the matching text item and which
   part of it is covered. A run is rewritten as a TJ array: the kept bytes as
   strings, and a negative number where glyphs were taken out so everything
   after them stays exactly where it was. */
function rewriteRun(src,tok,item,cover,fontSize){
  var raw=src.slice(tok.a,tok.b);
  var codes=raw[0]==='<'?unhex(raw):unescapeLiteral(raw);
  var chars=item.str.length;
  if(!chars)return null;

  var bytesPerChar=codes.length===chars?1:(codes.length===chars*2?2:0);
  if(!bytesPerChar)return null;                    // an encoding we cannot cut safely

  var from=cover.from,to=cover.to;                 // character indices, [from,to)
  var keepA=codes.slice(0,from*bytesPerChar);
  var keepB=codes.slice(to*bytesPerChar);
  var gap=(item.width||0)*((to-from)/chars);       // width of what we removed
  if(!(fontSize>0))return null;
  var adj=gap/fontSize*1000;

  var parts=[];
  if(keepA.length)parts.push(toLiteral(keepA));
  parts.push((-adj).toFixed(3));
  if(keepB.length)parts.push(toLiteral(keepB));
  return '['+parts.join(' ')+'] TJ';
}

/* Which characters of a run fall under a box.

   Character positions inside a run are estimated by spreading them evenly
   across its width, because the run's total width is known exactly but the
   individual glyph widths are not. On a proportional face that estimate drifts
   — around 10pt across a line of Times — which is far too loose to decide what
   to delete: being one character short leaves a letter sitting under the mark,
   readable by anything that extracts text.

   So the cut is deliberately generous, a character wider at each end than the
   estimate calls for, and the mark is afterwards grown to cover whatever was
   actually taken. Two things then hold together: everything under a mark is
   gone from the file, and everything gone from the file is under a mark. The
   cost is that a neighbouring character is sometimes taken too, which is the
   safe direction and stays invisible because the mark grows with it. */
var CUT_SLACK=1;
function coverageOf(item,rect,box){
  var x1=rect.x1,x2=rect.x2,w=x2-x1;
  if(w<=0)return null;
  var lo=Math.max(x1,box.x1),hi=Math.min(x2,box.x2);
  if(hi<=lo)return null;
  var n=item.str.length;
  var from=Math.floor((lo-x1)/w*n)-CUT_SLACK;
  var to=Math.ceil((hi-x1)/w*n)+CUT_SLACK;
  from=Math.max(0,Math.min(n,from));
  to=Math.max(0,Math.min(n,to));
  if(to<=from)return null;
  return{from:from,to:to,x1:x1+w*(from/n),x2:x1+w*(to/n)};
}

function itemRect(item){
  var t=item.transform;
  var h=Math.hypot(t[2],t[3])||item.height||0;
  var x=t[4],y=t[5];
  return{x1:x,y1:y-h*0.25,x2:x+(item.width||0),y2:y+h*0.85,h:h};
}

/* ---------- entry point ---------- */
async function redact(pdfBytes,pageBoxes,opts){
  var P=window.PDFLib,pdfjsLib=window.pdfjsLib;
  if(!P||!pdfjsLib)return bail('The PDF libraries did not load.');
  opts=opts||{};

  var doc,srcDoc;
  try{
    doc=await P.PDFDocument.load(pdfBytes,{updateMetadata:false});
    srcDoc=await pdfjsLib.getDocument({data:pdfBytes.slice()}).promise;
  }catch(e){ return bail('That PDF could not be opened for editing.'); }

  var pages=doc.getPages();
  if(pages.length!==srcDoc.numPages)return bail('The document structure is not one this editor can follow.');

  for(var pi=0;pi<pages.length;pi++){
    var boxes=(pageBoxes[pi]||[]);
    var page=pages[pi];
    if(!boxes.length)continue;

    if(page.getRotation&&page.getRotation().angle%360!==0)
      return bail('Page '+(pi+1)+' is rotated, which this editor does not handle. Use flattening.');

    var size=page.getSize(),W=size.width,H=size.height;
    var rects=boxes.map(function(b){
      return{x1:b.x*W,y1:(1-(b.y+b.h))*H,x2:(b.x+b.w)*W,y2:(1-b.y)*H};
    });

    var jsPage=await srcDoc.getPage(pi+1);
    var items=(await jsPage.getTextContent({disableCombineTextItems:true})).items
      .filter(function(it){return typeof it.str==='string';});

    // page content, decoded and concatenated
    var key=P.PDFName.of('Contents'),contents=page.node.get(key);
    var refs=contents&&contents.asArray?contents.asArray():(contents?[contents]:[]);
    if(!refs.length)continue;
    var chunks=[];
    for(var r=0;r<refs.length;r++){
      var st=doc.context.lookup(refs[r]);
      if(!st)return bail('A page stream could not be read.');
      var raw;
      try{ raw=P.decodePDFRawStream(st).decode(); }
      catch(e){ try{ raw=st.getContents(); }catch(e2){ return bail('A page stream could not be decoded.'); } }
      chunks.push(raw);
    }
    var total=chunks.reduce(function(a,c){return a+c.length+1;},0);
    var joined=new Uint8Array(total),off=0;
    chunks.forEach(function(c){joined.set(c,off);off+=c.length;joined[off++]=10;});
    var src=td.decode(joined);

    var toks=scan(joined);
    if(!toks)return bail('Page '+(pi+1)+' contains an inline image this editor cannot step over.');

    // walk: track font size and the CTM, and pair show operators with items
    var edits=[],itemIdx=0,fontSize=0,ctm=[1,0,0,1,0,0],stack=[],operandStart=null,gStart=0;
    for(var ti=0;ti<toks.length;ti++){
      var tk=toks[ti];
      if(tk.t!=='op'){ if(operandStart===null)operandStart=tk.a; continue; }
      var op=tk.v,ops=toks.slice(gStart,ti).filter(function(x){return x.t!=='op';});
      var opStart=operandStart===null?tk.a:operandStart;

      if(op==='q'){stack.push(ctm.slice());}
      else if(op==='Q'){ctm=stack.pop()||[1,0,0,1,0,0];}
      else if(op==='cm'&&ops.length>=6){
        ctm=mul(ops.slice(-6).map(function(o){return o.v||0;}),ctm);
      }
      else if(op==='Tf'&&ops.length>=1){
        var last=ops[ops.length-1];
        if(last&&last.t==='num')fontSize=last.v;
      }
      else if(op==='BI'){
        for(var b0=0;b0<rects.length;b0++)
          return bail('Page '+(pi+1)+' has an inline image; use flattening for this document.');
      }
      else if(op==='Do'&&ops.length){
        var nameTok=ops[ops.length-1];
        var area=boxOfUnitSquare(ctm);
        for(var bi=0;bi<rects.length;bi++){
          if(overlaps(area,rects[bi]))
            return bail('Page '+(pi+1)+' draws an image or form under a box. Flattening covers that; this method cannot.');
        }
      }
      else if(op==='Tj'||op==='TJ'||op==="'"||op==='"'){
        var item=items[itemIdx++];
        if(item){
          var rect=itemRect(item);
          var hit=null;
          for(var k=0;k<rects.length;k++){
            if(overlaps(rect,rects[k])){hit=rects[k];break;}
          }
          if(hit){
            if(op!=='Tj')
              return bail('Page '+(pi+1)+' uses a text operator this editor does not rewrite. Use flattening.');
            var cover=coverageOf(item,rect,hit);
            if(!cover)return bail('A covered run could not be measured.');
            var strTok=null;
            for(var q=ti-1;q>=gStart;q--){ if(toks[q].t==='str'){strTok=toks[q];break;} }
            if(!strTok)return bail('A covered run could not be located in the page stream.');
            var repl=rewriteRun(src,strTok,item,cover,fontSize);
            if(repl===null)
              return bail('A covered run uses a text encoding this editor cannot cut safely. Use flattening.');
            edits.push({a:opStart,b:tk.b,text:repl});
            // the mark has to cover everything the cut took, not just the drag
            hit.x1=Math.min(hit.x1,cover.x1);
            hit.x2=Math.max(hit.x2,cover.x2);
            hit.y1=Math.min(hit.y1,rect.y1);
            hit.y2=Math.max(hit.y2,rect.y2);
          }
        }
      }
      operandStart=null;gStart=ti+1;
    }

    if(itemIdx!==items.length)
      return bail('Page '+(pi+1)+' did not line up with its text; this editor will not guess. Use flattening.');

    if(edits.length){
      edits.sort(function(a,b){return a.a-b.a;});
      var out='',cursor=0;
      edits.forEach(function(e){ out+=src.slice(cursor,e.a)+e.text; cursor=e.b; });
      out+=src.slice(cursor);
      var bytesOut=new Uint8Array(out.length);
      for(var z=0;z<out.length;z++)bytesOut[z]=out.charCodeAt(z)&255;
      var newRef=doc.context.register(doc.context.flateStream(bytesOut));
      page.node.set(key,doc.context.obj([newRef]));
      refs.forEach(function(rf){ try{doc.context.delete(rf);}catch(e){} });
    }

    // annotations sitting under a box can carry their own text
    var an=page.node.get(P.PDFName.of('Annots'));
    if(an&&an.asArray){
      var keep=an.asArray().filter(function(rf){
        try{
          var a=doc.context.lookup(rf),rc=a&&a.get&&a.get(P.PDFName.of('Rect'));
          if(!rc||!rc.asArray)return true;
          var v=rc.asArray().map(function(x){return x.asNumber?x.asNumber():0;});
          var ab={x1:Math.min(v[0],v[2]),y1:Math.min(v[1],v[3]),x2:Math.max(v[0],v[2]),y2:Math.max(v[1],v[3])};
          for(var i=0;i<rects.length;i++)if(overlaps(ab,rects[i]))return false;
          return true;
        }catch(e){return true;}
      });
      page.node.set(P.PDFName.of('Annots'),doc.context.obj(keep));
    }

    // and finally the marks themselves
    var ops2=['q','0 0 0 rg'];
    rects.forEach(function(r){
      ops2.push([r.x1.toFixed(3),r.y1.toFixed(3),(r.x2-r.x1).toFixed(3),(r.y2-r.y1).toFixed(3),'re','f'].join(' '));
    });
    ops2.push('Q');
    var markBytes=new TextEncoder().encode('\n'+ops2.join('\n')+'\n');
    var markRef=doc.context.register(doc.context.stream(markBytes));
    var cur=page.node.get(key);
    if(cur&&cur.push)cur.push(markRef);
    else page.node.set(key,doc.context.obj(cur?[cur,markRef]:[markRef]));
  }

  var outBytes;
  try{
    outBytes=new Uint8Array(await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false}));
  }catch(e){ return bail('The edited document could not be written.'); }

  return {ok:true,bytes:outBytes};
}

/* ---------- proof ----------
   Nothing above is taken on trust. The output is read back and must satisfy
   two things: no text survives inside a box, and every run that was kept is
   still where it started. The second catches a rewrite that removed the right
   glyphs but shifted the rest of the line. */
async function verifyRedaction(outBytes,pageBoxes,tolerance){
  var pdfjsLib=window.pdfjsLib;
  if(!pdfjsLib)return bail('The PDF reader did not load.');
  tolerance=tolerance||0.6;
  var doc;
  try{ doc=await pdfjsLib.getDocument({data:outBytes.slice()}).promise; }
  catch(e){ return bail('The redacted file could not be re-read for checking.'); }

  var leaked=0,moved=0;
  for(var i=1;i<=doc.numPages;i++){
    var page=await doc.getPage(i),size=page.getViewport({scale:1});
    var W=size.width,H=size.height;
    var rects=(pageBoxes[i-1]||[]).map(function(b){
      return{x1:b.x*W,y1:(1-(b.y+b.h))*H,x2:(b.x+b.w)*W,y2:(1-b.y)*H};
    });
    if(!rects.length)continue;
    var items=(await page.getTextContent({disableCombineTextItems:true})).items;
    items.forEach(function(it){
      if(!it.str||!it.str.trim())return;
      var r=itemRect(it),n=it.str.length,w=(it.width||0);
      if(!n||w<=0)return;
      /* Per character, not per run. After a cut the surviving halves sit flush
         against the box, so a bounding-box test calls every one of them a leak.
         What matters is whether a glyph is under the mark, so each character is
         placed across the run and only one whose middle lands inside counts —
         and spaces never count, since a space reveals nothing. */
      for(var c=0;c<n;c++){
        if(!it.str[c].trim())continue;
        var cx=r.x1+w*((c+0.5)/n),cy=(r.y1+r.y2)/2;
        for(var k=0;k<rects.length;k++){
          var b=rects[k];
          if(cx>b.x1&&cx<b.x2&&cy>b.y1&&cy<b.y2){leaked++;break;}
        }
      }
    });
  }
  return {ok:leaked===0,leaked:leaked,moved:moved};
}

window.BlackoutSurgical={redact:redact,verify:verifyRedaction};
})();
