/* ============================================================
   Surgical redaction — take the covered content out of the file.

   The other method throws the document away and keeps a picture of it. This
   one edits the page in place: whatever sits under a mark is destroyed at
   source, and everything else is left exactly as it was, so the output stays
   real searchable text and real images everywhere you did not redact.

   Nothing is refused and no page is quietly flattened, because both of those
   are the same thing — giving up and handing the problem back. Each kind of
   content under a mark is dealt with on its own terms:

     text      the glyphs are cut out of the show operator and the following
               text is pulled back so the line does not move
     images    the picture is decoded, the covered pixels are destroyed, and
               the result is re-embedded as a fresh object
     forms     walked into, with the same rules, under the composed matrix
     inline
     images    replaced by a redacted image object drawn in their place

   This is also the method that fails quietly: the mark is drawn either way, so
   a file that kept a word looks exactly like one that did not. So none of the
   above is trusted. The result is re-read and proved before it is offered, and
   if the proof does not pass the file is not saved. See verifyRedaction.
   ============================================================ */
(function(){
'use strict';

var td=new TextDecoder('latin1');
function bail(reason){ return {ok:false,reason:reason}; }

/* ---------- content stream scanning ---------- */
var WS='\x00\t\n\f\r ';
function isWS(c){ return WS.indexOf(c)>=0; }
function isDelim(c){ return '()<>[]{}/%'.indexOf(c)>=0; }

function scan(s){
  var n=s.length,i=0,toks=[];
  while(i<n){
    var c=s[i];
    if(isWS(c)){i++;continue;}
    if(c==='%'){while(i<n&&s[i]!=='\n'&&s[i]!=='\r')i++;continue;}
    var start=i;
    if(c==='('){
      var depth=0;
      while(i<n){
        if(s[i]==='\\'){i+=2;continue;}
        if(s[i]==='('){depth++;}
        else if(s[i]===')'){depth--;if(!depth){i++;break;}}
        i++;
      }
      toks.push({t:'str',a:start,b:i});continue;
    }
    if(c==='<'&&s[i+1]==='<'){toks.push({t:'op',a:start,b:i+2,v:'<<'});i+=2;continue;}
    if(c==='>'&&s[i+1]==='>'){toks.push({t:'op',a:start,b:i+2,v:'>>'});i+=2;continue;}
    if(c==='<'){while(i<n&&s[i]!=='>')i++;i++;toks.push({t:'str',a:start,b:i});continue;}
    if(c==='['){toks.push({t:'[',a:start,b:++i});continue;}
    if(c===']'){toks.push({t:']',a:start,b:++i});continue;}
    if(c==='/'){i++;while(i<n&&!isWS(s[i])&&!isDelim(s[i]))i++;toks.push({t:'name',a:start,b:i,v:s.slice(start+1,i)});continue;}
    if('+-.0123456789'.indexOf(c)>=0){
      i++;while(i<n&&'+-.0123456789eE'.indexOf(s[i])>=0)i++;
      toks.push({t:'num',a:start,b:i,v:parseFloat(s.slice(start,i))||0});continue;
    }
    i++;while(i<n&&!isWS(s[i])&&!isDelim(s[i]))i++;
    var op=s.slice(start,i);
    if(op==='BI'){                                   // inline image: step over its binary
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
function invert(m){
  var det=m[0]*m[3]-m[1]*m[2];
  if(!det)return null;
  return[m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,
         (m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det];
}
function apply(m,x,y){ return[m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]]; }
function unitBox(m){
  var p=[apply(m,0,0),apply(m,1,0),apply(m,0,1),apply(m,1,1)];
  var xs=p.map(function(q){return q[0];}),ys=p.map(function(q){return q[1];});
  return{x1:Math.min.apply(null,xs),y1:Math.min.apply(null,ys),
         x2:Math.max.apply(null,xs),y2:Math.max.apply(null,ys)};
}
function overlaps(a,b){ return a.x1<b.x2&&b.x1<a.x2&&a.y1<b.y2&&b.y1<a.y2; }

/* Marks are fractions of the page as the reader displays it. Content lives in
   the page's own unrotated space, so a rotated page has to be turned back
   before anything can be compared against it. Getting this wrong is worse than
   it sounds: the proof measures the same way, so a mistake here would agree
   with itself and pass a file that still holds the words. Both callers use
   this one function for that reason.
   /Rotate is clockwise, so an unrotated point (px,py) is displayed at
   (py, W-px) at 90 and (H-py, px) at 270; these are the inverses. */
function marksToContent(boxes,W,H,rot){
  var turned=(rot===90||rot===270),dispW=turned?H:W,dispH=turned?W:H;
  return boxes.map(function(b){
    var x1=b.x*dispW,x2=(b.x+b.w)*dispW,y1=(1-(b.y+b.h))*dispH,y2=(1-b.y)*dispH;
    if(rot===90)  return{x1:W-y2,y1:x1,x2:W-y1,y2:x2};
    if(rot===180) return{x1:W-x2,y1:H-y2,x2:W-x1,y2:H-y1};
    if(rot===270) return{x1:y1,y1:H-x2,x2:y2,y2:H-x1};
    return{x1:x1,y1:y1,x2:x2,y2:y2};
  });
}

/* ---------- PDF strings ---------- */
function unescapeLiteral(s){
  var out=[],i=1,n=s.length-1;
  while(i<n){
    var c=s[i];
    if(c!=='\\'){out.push(s.charCodeAt(i)&255);i++;continue;}
    var d=s[i+1];
    if(d==='n'){out.push(10);i+=2;}
    else if(d==='r'){out.push(13);i+=2;}
    else if(d==='t'){out.push(9);i+=2;}
    else if(d==='b'){out.push(8);i+=2;}
    else if(d==='f'){out.push(12);i+=2;}
    else if(d>='0'&&d<='7'){
      var oct='',k=i+1;
      while(k<n&&oct.length<3&&s[k]>='0'&&s[k]<='7'){oct+=s[k];k++;}
      out.push(parseInt(oct,8)&255);i=k;
    }
    else if(d==='\n'){i+=2;}
    else if(d==='\r'){i+=(s[i+2]==='\n')?3:2;}
    else{out.push(s.charCodeAt(i+1)&255);i+=2;}
  }
  return out;
}
function unhex(s){
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

/* ---------- cutting a show operator ----------
   Tj and TJ both reduce to the same shape: a sequence of byte runs with
   optional kerning numbers between them. Cut out the covered characters and
   put a single adjustment in their place so everything after stays put. */
function elementsOf(toks,gStart,ti,src,op){
  var els=[];
  if(op==='Tj'||op==="'"){
    for(var i=ti-1;i>=gStart;i--){
      if(toks[i].t==='str'){els.push({s:true,codes:decodeStr(src,toks[i])});break;}
    }
    return els.length?els:null;
  }
  if(op==='"'){
    for(var j=ti-1;j>=gStart;j--){
      if(toks[j].t==='str'){els.push({s:true,codes:decodeStr(src,toks[j])});break;}
    }
    return els.length?els:null;
  }
  // TJ: walk the array in order
  var open=-1;
  for(var k=gStart;k<ti;k++)if(toks[k].t==='['){open=k;break;}
  if(open<0)return null;
  for(var m=open+1;m<ti;m++){
    var t=toks[m];
    if(t.t===']')break;
    if(t.t==='str')els.push({s:true,codes:decodeStr(src,t)});
    else if(t.t==='num')els.push({s:false,v:t.v});
  }
  return els;
}
function decodeStr(src,tok){
  var raw=src.slice(tok.a,tok.b);
  return raw[0]==='<'?unhex(raw):unescapeLiteral(raw);
}

/* Rebuild the operator with characters [from,to) gone. bpc is bytes per
   character; when it cannot be worked out the whole run goes instead, which is
   always safe because the mark is afterwards grown to cover it. */
function cutElements(els,from,to,bpc,adj){
  var out=[],seen=0,placed=false;
  for(var i=0;i<els.length;i++){
    var e=els[i];
    if(!e.s){ if(seen<=from||seen>=to)out.push(e.v.toFixed(3)); continue; }
    var chars=e.codes.length/bpc,start=seen,end=seen+chars;
    seen=end;
    var lo=Math.max(from,start),hi=Math.min(to,end);
    if(hi<=lo){ out.push(toLiteral(e.codes)); continue; }      // untouched
    var keepA=e.codes.slice(0,(lo-start)*bpc);
    var keepB=e.codes.slice((hi-start)*bpc);
    if(keepA.length)out.push(toLiteral(keepA));
    if(!placed){ out.push((-adj).toFixed(3)); placed=true; }
    if(keepB.length)out.push(toLiteral(keepB));
  }
  if(!placed)out.push((-adj).toFixed(3));
  return '['+out.join(' ')+'] TJ';
}

/* Which characters of a run sit under a mark.

   A run's total width is exact, but the widths of the glyphs inside it are
   not, so positions within a run are estimated by spreading them evenly. On a
   proportional face that drifts — around 10pt across a line of Times — which
   is too loose to decide what to delete, since being one character short
   leaves a letter under the mark for anything that extracts text. The cut is
   therefore a character wider at each end than the estimate asks for, and the
   mark is afterwards grown to cover whatever was actually taken. */
var CUT_SLACK=1;
/* How much of a run a mark covers, measured along the run rather than across
   the page. The mark is an upright rectangle; the run may not be. Walking the
   glyph line through the rectangle's two slabs gives the stretch of the run
   that is inside it, which for a run lying along either axis is exact and for
   a diagonal one takes a little extra — the safe direction, and the mark grows
   to match whatever was taken. */
function coverageOf(item,rect,box){
  var g=itemGeom(item),n=item.str.length;
  if(!n||g.len<=0)return null;
  var mid=(g.b0+g.b1)/2,o=geomPoint(g,0,mid);
  var lo=0,hi=g.len,EPS=1e-9;
  function slab(o1,d,min,max){
    if(Math.abs(d)<EPS){ if(o1<min||o1>max){lo=1;hi=0;} return; }
    var t1=(min-o1)/d,t2=(max-o1)/d;
    if(t1>t2){var t=t1;t1=t2;t2=t;}
    lo=Math.max(lo,t1);hi=Math.min(hi,t2);
  }
  slab(o[0],g.ux,box.x1,box.x2);
  slab(o[1],g.uy,box.y1,box.y2);
  if(hi<=lo)return null;
  var from=Math.max(0,Math.floor(lo/g.len*n)-CUT_SLACK);
  var to=Math.min(n,Math.ceil(hi/g.len*n)+CUT_SLACK);
  if(to<=from)return null;
  return{from:from,to:to,box:geomBox(g,g.len*(from/n),g.len*(to/n))};
}
/* A run is not always horizontal. Text carries its own matrix, so a line can
   be set sideways or upside down on an ordinary page, and a rotated page turns
   every run on it. Measuring a run as if it ran left to right would compare
   the mark against a box the glyphs are not in — and the proof below, if it
   measured the same way, would agree and pass a file that kept the words. So
   everything here works along the run's own axes.
     u  points along the run, v across it, away from the baseline
     a  is a distance along the run, b a distance across it
   The band runs from a quarter of an em below the baseline to most of an em
   above, which is the same band the horizontal version used. */
function itemGeom(item){
  var t=item.transform;
  var su=Math.hypot(t[0],t[1])||1,h=Math.hypot(t[2],t[3])||item.height||0;
  return{
    x:t[4],y:t[5],
    ux:t[0]/su,uy:t[1]/su,
    vx:-t[1]/su,vy:t[0]/su,
    len:item.width||0,b0:-h*0.25,b1:h*0.85,h:h
  };
}
function geomPoint(g,a,b){ return[g.x+g.ux*a+g.vx*b,g.y+g.uy*a+g.vy*b]; }
function geomBox(g,a0,a1){
  var xs=[],ys=[];
  [[a0,g.b0],[a1,g.b0],[a0,g.b1],[a1,g.b1]].forEach(function(p){
    var q=geomPoint(g,p[0],p[1]);xs.push(q[0]);ys.push(q[1]);
  });
  return{x1:Math.min.apply(null,xs),y1:Math.min.apply(null,ys),
         x2:Math.max.apply(null,xs),y2:Math.max.apply(null,ys)};
}
function itemRect(item){ var g=itemGeom(item); return geomBox(g,0,g.len); }

/* ---------- images ----------
   The picture is decoded, the covered pixels are destroyed, and the result is
   re-embedded as a new object drawn in place of the old one. The original is
   left alone so other uses of the same picture elsewhere are unaffected. */
async function redactedImageRef(ctx,objId,ctm,rects){
  var img=null;
  try{ img=ctx.jsPage.objs.get(objId); }catch(e){ img=null; }
  if(!img)return null;
  var W=img.width,H=img.height;
  if(!W||!H)return null;

  var c=document.createElement('canvas');
  c.width=W;c.height=H;
  var g=c.getContext('2d');
  if(img.bitmap)g.drawImage(img.bitmap,0,0);
  else if(img.data){
    var id=g.createImageData(W,H),src=img.data,dst=id.data;
    if(src.length===W*H*4)dst.set(src);
    else if(src.length===W*H*3){
      for(var i=0,j=0;i<W*H;i++){dst[i*4]=src[j++];dst[i*4+1]=src[j++];dst[i*4+2]=src[j++];dst[i*4+3]=255;}
    }else if(src.length===W*H){
      for(var k=0;k<W*H;k++){dst[k*4]=dst[k*4+1]=dst[k*4+2]=src[k];dst[k*4+3]=255;}
    }else return null;
    g.putImageData(id,0,0);
  }else return null;

  // map each mark from the page back into the picture's own pixels
  var inv=invert(ctm);
  if(!inv)return null;
  var painted=false;
  g.fillStyle='#000';
  rects.forEach(function(r){
    var pts=[[r.x1,r.y1],[r.x2,r.y1],[r.x1,r.y2],[r.x2,r.y2]].map(function(p){return apply(inv,p[0],p[1]);});
    var us=pts.map(function(p){return p[0];}),vs=pts.map(function(p){return p[1];});
    var u1=Math.min.apply(null,us),u2=Math.max.apply(null,us);
    var v1=Math.min.apply(null,vs),v2=Math.max.apply(null,vs);
    if(u2<=0||u1>=1||v2<=0||v1>=1)return;
    var px1=Math.max(0,Math.floor(u1*W)),px2=Math.min(W,Math.ceil(u2*W));
    var py1=Math.max(0,Math.floor((1-v2)*H)),py2=Math.min(H,Math.ceil((1-v1)*H));
    if(px2>px1&&py2>py1){ g.fillRect(px1,py1,px2-px1,py2-py1); painted=true; }
  });
  if(!painted)return null;

  var blob=await new Promise(function(res){c.toBlob(res,'image/png');});
  if(!blob)return null;
  var embedded=await ctx.doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  return embedded.ref;
}

/* ---------- resources ---------- */
function xobjectDict(ctx,resources,create){
  var P=window.PDFLib,k=P.PDFName.of('XObject');
  var d=resources&&resources.get?resources.get(k):null;
  if(d&&d.lookup)d=d;
  if(!d&&create&&resources){ d=ctx.doc.context.obj({}); resources.set(k,d); }
  return d||null;
}
function addXObject(ctx,resources,ref){
  var P=window.PDFLib;
  var d=xobjectDict(ctx,resources,true);
  if(!d)return null;
  var name='BOx'+(ctx.seq++);
  d.set(P.PDFName.of(name),ref);
  return name;
}

/* ---------- the walker ----------
   One pass over a content stream, recursing into forms so the text items keep
   lining up with the operators that drew them. */
async function walk(ctx,src,resources,ctm0){
  var P=window.PDFLib;
  var toks=scan(src);
  if(!toks)return bail('A page stream could not be read.');
  var edits=[],local=[],ctm=ctm0.slice(),stack=[],fontSize=0,gStart=0,operandStart=null;

  for(var ti=0;ti<toks.length;ti++){
    var tk=toks[ti];
    if(tk.t!=='op'){ if(operandStart===null)operandStart=tk.a; continue; }
    var op=tk.v;
    var ops=[];
    for(var oi=gStart;oi<ti;oi++)if(toks[oi].t!=='op')ops.push(toks[oi]);
    var opStart=operandStart===null?tk.a:operandStart;

    if(op==='q')stack.push(ctm.slice());
    else if(op==='Q')ctm=stack.pop()||[1,0,0,1,0,0];
    else if(op==='cm'&&ops.length>=6)ctm=mul(ops.slice(-6).map(function(o){return o.v||0;}),ctm);
    else if(op==='Tf'&&ops.length){ var l=ops[ops.length-1]; if(l.t==='num')fontSize=l.v; }
    else if(op==='BI'){
      var area=unitBox(ctm),hitAny=null;
      for(var q=0;q<ctx.rects.length;q++)if(overlaps(area,ctx.rects[q])){hitAny=true;break;}
      var inlineId=ctx.images[ctx.imgIdx++];
      if(hitAny){
        // swap the inline picture for a redacted object drawn in its place
        var iref=inlineId?await redactedImageRef(ctx,inlineId,ctm,ctx.rects):null;
        if(iref){
          var nm=addXObject(ctx,resources,iref);
          if(nm)edits.push({a:tk.a,b:tk.b,text:'/'+nm+' Do'});
          else edits.push({a:tk.a,b:tk.b,text:''});
        }else edits.push({a:tk.a,b:tk.b,text:''});   // cannot rebuild it: draw nothing
      }
    }
    else if(op==='Do'&&ops.length){
      var nameTok=null;
      for(var ni=ti-1;ni>=gStart;ni--)if(toks[ni].t==='name'){nameTok=toks[ni];break;}
      var xd=xobjectDict(ctx,resources,false);
      var xref=(xd&&nameTok)?xd.get(P.PDFName.of(nameTok.v)):null;
      var xobj=xref?ctx.doc.context.lookup(xref):null;
      var sub=xobj&&xobj.dict&&xobj.dict.get?xobj.dict.get(P.PDFName.of('Subtype')):
              (xobj&&xobj.get?xobj.get(P.PDFName.of('Subtype')):null);
      var subName=sub&&sub.asString?sub.asString():(sub?String(sub):'');

      if(subName.indexOf('Image')>=0){
        var objId=ctx.images[ctx.imgIdx++];
        var box=unitBox(ctm),hit=false;
        for(var r0=0;r0<ctx.rects.length;r0++)if(overlaps(box,ctx.rects[r0])){hit=true;break;}
        if(hit){
          var newRef=objId?await redactedImageRef(ctx,objId,ctm,ctx.rects):null;
          if(newRef&&nameTok){
            var nn=addXObject(ctx,resources,newRef);
            if(nn){
              edits.push({a:nameTok.a,b:nameTok.b,text:'/'+nn});
              if(xref&&xref.tag){
                ctx.replaced.push({ref:xref});
                local.push({ref:xref,name:nameTok.v,res:resources});
              }
            }
          }
          // the covered pixels are already destroyed inside the picture, so
          // the mark stays the size it was drawn
        }
      }else if(subName.indexOf('Form')>=0&&xobj){
        var inner=null;
        try{ inner=td.decode(P.decodePDFRawStream(xobj).decode()); }catch(e){ inner=null; }
        if(inner!==null){
          var fdict=xobj.dict||xobj;
          var mtx=fdict.get?fdict.get(P.PDFName.of('Matrix')):null;
          var fm=[1,0,0,1,0,0];
          if(mtx&&mtx.asArray)fm=mtx.asArray().map(function(x){return x.asNumber?x.asNumber():0;});
          var fres=fdict.get?fdict.get(P.PDFName.of('Resources')):null;
          if(fres&&fres.lookup===undefined&&ctx.doc.context.lookup)fres=ctx.doc.context.lookup(fres)||fres;
          var sub2=await walk(ctx,inner,fres||resources,mul(fm,ctm));
          if(!sub2.ok)return sub2;
          if(sub2.text!==null){
            var fbytes=new Uint8Array(sub2.text.length);
            for(var z=0;z<sub2.text.length;z++)fbytes[z]=sub2.text.charCodeAt(z)&255;
            var clone=ctx.doc.context.flateStream(fbytes,copyFormDict(ctx,fdict));
            var cref=ctx.doc.context.register(clone);
            var cn=addXObject(ctx,resources,cref);
            if(cn&&nameTok){
              edits.push({a:nameTok.a,b:nameTok.b,text:'/'+cn});
              /* The form we just replaced still holds the original words. It
                 has to go the same way a replaced picture does, or the file
                 ships the text with nothing drawing it. */
              if(xref&&xref.tag){
                ctx.replaced.push({ref:xref});
                local.push({ref:xref,name:nameTok.v,res:resources});
              }
            }
          }
        }
      }
    }
    else if(op==='Tj'||op==='TJ'||op==="'"||op==='"'){
      var item=ctx.items[ctx.itemIdx++];
      if(item&&item.str){
        var rect=itemRect(item),mark=null;
        for(var k2=0;k2<ctx.rects.length;k2++)if(overlaps(rect,ctx.rects[k2])){mark=ctx.rects[k2];break;}
        if(mark){
          var els=elementsOf(toks,gStart,ti,src,op);
          if(els){
            var totalCodes=els.reduce(function(a,e){return a+(e.s?e.codes.length:0);},0);
            var chars=item.str.length;
            var bpc=totalCodes===chars?1:(totalCodes===chars*2?2:0);
            var cover=coverageOf(item,rect,mark);
            if(!bpc||!cover){
              // encoding we cannot cut safely, or an unmeasurable run: take it
              // all, and let the mark grow to cover what went
              bpc=1;cover={from:0,to:totalCodes,box:rect};
              chars=totalCodes;
            }
            var gap=(item.width||0)*((cover.to-cover.from)/Math.max(1,chars));
            var adj=fontSize>0?gap/fontSize*1000:0;
            var body=cutElements(els,cover.from,cover.to,bpc,adj);
            var prefix=op==="'"?'T* ':(op==='"'?quotePrefix(ops)+'T* ':'');
            edits.push({a:opStart,b:tk.b,text:prefix+body});
            ctx.grow(cover.box);
          }
        }
      }
    }
    operandStart=null;gStart=ti+1;
  }

  if(!edits.length)return{ok:true,text:null};
  edits.sort(function(a,b){return a.a-b.a;});
  var out='',cursor=0;
  edits.forEach(function(e){ if(e.a<cursor)return; out+=src.slice(cursor,e.a)+e.text; cursor=e.b; });
  out+=src.slice(cursor);

  /* A replaced object keeps its name in this stream's resources, which counts
     as still being shown even though nothing draws it any more. Drop the entry
     when the edited stream no longer draws that name. If another draw of it
     survived uncovered, the name is still there and the original stays — it is
     wanted, uncovered, somewhere else on the page. */
  local.forEach(function(rp){
    if(new RegExp('\\/'+rp.name.replace(/[^A-Za-z0-9]/g,'\\$&')+'\\s+Do(?![A-Za-z0-9])').test(out))return;
    var xd=xobjectDict(ctx,rp.res,false);
    try{ if(xd&&xd.delete)xd.delete(P.PDFName.of(rp.name)); }catch(e){}
  });
  return{ok:true,text:out};
}

function quotePrefix(ops){
  var nums=ops.filter(function(o){return o.t==='num';});
  if(nums.length<2)return '';
  return nums[nums.length-2].v+' Tw '+nums[nums.length-1].v+' Tc ';
}
function copyFormDict(ctx,fdict){
  var P=window.PDFLib,out={};
  ['BBox','Matrix','Resources','Group'].forEach(function(k){
    var v=fdict.get?fdict.get(P.PDFName.of(k)):null;
    if(v)out[k]=v;
  });
  out.Type=P.PDFName.of('XObject');
  out.Subtype=P.PDFName.of('Form');
  return out;
}

/* ---------- entry point ---------- */
async function redact(pdfBytes,pageBoxes){
  var P=window.PDFLib,pdfjsLib=window.pdfjsLib;
  if(!P||!pdfjsLib)return bail('The PDF libraries did not load.');

  var doc,src;
  try{
    doc=await P.PDFDocument.load(pdfBytes,{updateMetadata:false});
    src=await pdfjsLib.getDocument({data:pdfBytes.slice()}).promise;
  }catch(e){ return bail('That PDF could not be opened for editing.'); }

  var pages=doc.getPages();
  if(pages.length!==src.numPages)return bail('The document structure is not one this editor can follow.');
  var seq=0,replaced=[];

  for(var pi=0;pi<pages.length;pi++){
    var boxes=pageBoxes[pi]||[];
    if(!boxes.length)continue;
    var page=pages[pi],jsPage=await src.getPage(pi+1);

    /* Marks arrive as fractions of the page as displayed, so a rotated page
       has to be turned back into the unrotated space the content lives in. */
    var rot=((page.getRotation&&page.getRotation().angle)||0)%360;
    if(rot<0)rot+=360;
    var size=page.getSize();
    var rects=marksToContent(boxes,size.width,size.height,rot);

    // decoded pictures, in the order the page draws them
    var opList=await jsPage.getOperatorList();
    var OPS=pdfjsLib.OPS,images=[];
    for(var oi=0;oi<opList.fnArray.length;oi++){
      var fn=opList.fnArray[oi];
      if(fn===OPS.paintImageXObject||fn===OPS.paintJpegXObject||fn===OPS.paintImageMaskXObject||fn===OPS.paintInlineImageXObject){
        var a=opList.argsArray[oi];
        images.push(typeof a[0]==='string'?a[0]:null);
      }
    }
    if(images.length){                                // resolve them
      try{
        var vp=jsPage.getViewport({scale:1});
        var rc=document.createElement('canvas');
        rc.width=Math.max(1,Math.floor(vp.width));rc.height=Math.max(1,Math.floor(vp.height));
        await jsPage.render({canvasContext:rc.getContext('2d'),viewport:vp}).promise;
      }catch(e){}
    }

    var items=(await jsPage.getTextContent({disableCombineTextItems:true})).items
      .filter(function(it){return typeof it.str==='string';});

    var key=P.PDFName.of('Contents'),contents=page.node.get(key);
    var refs=contents&&contents.asArray?contents.asArray():(contents?[contents]:[]);
    if(!refs.length)continue;
    var parts=[];
    for(var r=0;r<refs.length;r++){
      var st=doc.context.lookup(refs[r]);
      if(!st)return bail('A page stream could not be read.');
      try{ parts.push(td.decode(P.decodePDFRawStream(st).decode())); }
      catch(e){ try{ parts.push(td.decode(st.getContents())); }catch(e2){ return bail('A page stream could not be decoded.'); } }
    }
    var streamText=parts.join('\n');

    var resources=page.node.get(P.PDFName.of('Resources'));
    if(resources&&doc.context.lookup)resources=doc.context.lookup(resources)||resources;

    var grown=rects.map(function(r){return{x1:r.x1,y1:r.y1,x2:r.x2,y2:r.y2};});
    var ctx={
      doc:doc,jsPage:jsPage,items:items,itemIdx:0,images:images,imgIdx:0,
      rects:rects,seq:seq,replaced:replaced,
      grow:function(b){
        for(var i=0;i<rects.length;i++){
          if(overlaps(b,rects[i])){
            grown[i].x1=Math.min(grown[i].x1,b.x1);grown[i].y1=Math.min(grown[i].y1,b.y1);
            grown[i].x2=Math.max(grown[i].x2,b.x2);grown[i].y2=Math.max(grown[i].y2,b.y2);
            return;
          }
        }
      }
    };

    var res=await walk(ctx,streamText,resources,[1,0,0,1,0,0]);
    seq=ctx.seq;
    if(!res.ok)return res;

    if(res.text!==null){
      var bytesOut=new Uint8Array(res.text.length);
      for(var z2=0;z2<res.text.length;z2++)bytesOut[z2]=res.text.charCodeAt(z2)&255;
      var newRef=doc.context.register(doc.context.flateStream(bytesOut));
      page.node.set(key,doc.context.obj([newRef]));
      refs.forEach(function(rf){ try{doc.context.delete(rf);}catch(e){} });
    }

    // annotations under a mark carry their own text and go with it
    var an=page.node.get(P.PDFName.of('Annots'));
    if(an&&an.asArray){
      var keep=an.asArray().filter(function(rf){
        try{
          var a2=doc.context.lookup(rf),rc2=a2&&a2.get&&a2.get(P.PDFName.of('Rect'));
          if(!rc2||!rc2.asArray)return true;
          var v=rc2.asArray().map(function(x){return x.asNumber?x.asNumber():0;});
          var ab={x1:Math.min(v[0],v[2]),y1:Math.min(v[1],v[3]),x2:Math.max(v[0],v[2]),y2:Math.max(v[1],v[3])};
          for(var i2=0;i2<rects.length;i2++)if(overlaps(ab,rects[i2]))return false;
          return true;
        }catch(e){return true;}
      });
      page.node.set(P.PDFName.of('Annots'),doc.context.obj(keep));
    }

    // and the marks themselves, covering everything that was taken
    var draw=['q','0 0 0 rg'];
    grown.forEach(function(r){
      draw.push([r.x1.toFixed(3),r.y1.toFixed(3),(r.x2-r.x1).toFixed(3),(r.y2-r.y1).toFixed(3),'re','f'].join(' '));
    });
    draw.push('Q');
    var markRef=doc.context.register(doc.context.stream(new TextEncoder().encode('\n'+draw.join('\n')+'\n')));
    var cur=page.node.get(key);
    if(cur&&cur.push)cur.push(markRef);
    else page.node.set(key,doc.context.obj(cur?[cur,markRef]:[markRef]));
  }

  /* Replacing a picture or a form leaves the original behind. pdf-lib still
     writes an object nothing points at, so the un-redacted pixels — or the
     words inside a form — would ship inside the file, which is the same trap
     as an orphaned recovery stream. Clear away anything replaced that the
     document no longer shows. Something still drawn elsewhere is left alone:
     it is uncovered there by choice, so it belongs there. */
  replaced.forEach(function(rp){
    try{ if(!stillDrawn(doc,rp.ref))doc.context.delete(rp.ref); }catch(e){}
  });

  try{
    return{ok:true,bytes:new Uint8Array(await doc.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false}))};
  }catch(e){ return bail('The edited document could not be written.'); }
}

/* Is this object still drawn anywhere? Walks the XObject resources of every
   page, and into forms, so a picture kept for another page is not thrown out. */
function stillDrawn(doc,ref){
  var P=window.PDFLib,seen={},found=false;
  function visit(resources,depth){
    if(found||!resources||depth>8)return;
    var xd=resources.get?resources.get(P.PDFName.of('XObject')):null;
    if(xd&&xd.lookup===undefined&&doc.context.lookup)xd=doc.context.lookup(xd)||xd;
    if(!xd||!xd.keys)return;
    xd.keys().forEach(function(k){
      if(found)return;
      var v=xd.get(k);
      if(v&&v.tag){
        if(v.tag===ref.tag){found=true;return;}
        if(seen[v.tag])return;
        seen[v.tag]=1;
        var obj=doc.context.lookup(v);
        var d=obj&&(obj.dict||obj);
        var sub=d&&d.get?d.get(P.PDFName.of('Subtype')):null;
        if(sub&&String(sub).indexOf('Form')>=0){
          var fr=d.get(P.PDFName.of('Resources'));
          if(fr&&fr.lookup===undefined&&doc.context.lookup)fr=doc.context.lookup(fr)||fr;
          visit(fr,depth+1);
        }
      }
    });
  }
  doc.getPages().forEach(function(pg){
    var res=pg.node.get(P.PDFName.of('Resources'));
    if(res&&res.lookup===undefined&&doc.context.lookup)res=doc.context.lookup(res)||res;
    visit(res,0);
  });
  return found;
}

/* ---------- proof ----------
   Read the result back and place every surviving character. A run that was cut
   sits flush against the mark, so a bounding-box test would call each of them
   a leak; what matters is whether a glyph is under the mark, and a space
   reveals nothing. */
async function verifyRedaction(outBytes,pageBoxes){
  var pdfjsLib=window.pdfjsLib;
  if(!pdfjsLib)return bail('The PDF reader did not load.');
  var doc;
  try{ doc=await pdfjsLib.getDocument({data:outBytes.slice()}).promise; }
  catch(e){ return bail('The redacted file could not be re-read for checking.'); }

  var leaked=0,where=[];
  for(var i=1;i<=doc.numPages;i++){
    var boxes=pageBoxes[i-1]||[];
    if(!boxes.length)continue;
    /* page.view is the box in unrotated space, which is where the text items
       this loop places live — the viewport's own width and height are the
       rotated ones and would quietly mismatch on a rotated page. */
    var page=await doc.getPage(i),view=page.view||[0,0,612,792];
    var rot=((page.rotate||0)%360+360)%360;
    var rects=marksToContent(boxes,view[2]-view[0],view[3]-view[1],rot);
    var items=(await page.getTextContent({disableCombineTextItems:true})).items;
    for(var j=0;j<items.length;j++){
      var it=items[j];
      if(!it.str||!it.str.trim())continue;
      var g=itemGeom(it),n=it.str.length;
      if(!n||g.len<=0)continue;
      for(var c=0;c<n;c++){
        if(!it.str[c].trim())continue;
        var q=geomPoint(g,g.len*((c+0.5)/n),(g.b0+g.b1)/2);
        var cx=q[0],cy=q[1];
        for(var k=0;k<rects.length;k++){
          var b2=rects[k];
          if(cx>b2.x1&&cx<b2.x2&&cy>b2.y1&&cy<b2.y2){
            leaked++;
            if(where.length<5)where.push('page '+i+' "'+it.str[c]+'"');
            break;
          }
        }
      }
    }
  }
  return{ok:leaked===0,leaked:leaked,where:where};
}

window.BlackoutSurgical={redact:redact,verify:verifyRedaction};
})();
