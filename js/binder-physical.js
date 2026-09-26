/* METP physical binder motion patch
   Replaces the old two-leaf/panel turn at the interaction boundary with a
   single-sheet 3D turn. It deliberately uses the existing page renderer and
   spread model, so content/loading behavior stays unchanged.
*/
(function(){
  "use strict";
  const M=window.METP;
  const B=M && M.binder;
  if(!B) return;
  const binder=document.getElementById("binder");
  const spread=document.getElementById("spread");
  const lid=document.getElementById("lid");
  const sticker=document.querySelector(".sticker");
  const prev=document.getElementById("prevPage");
  const next=document.getElementById("nextPage");
  const peelL=document.getElementById("peelLeft");
  const peelR=document.getElementById("peelRight");
  let busy=false;

  const wait=ms=>new Promise(r=>setTimeout(r,ms));

  function faceFrom(el, side){
    const face=document.createElement("div");
    face.className="face "+side;
    face.style.cssText="position:absolute;inset:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#faf5e8;";
    face.appendChild(el.cloneNode(true));
    return face;
  }

  async function turn(target,dir){
    if(busy || !B.spreads || target<0 || target>=B.spreads.length || target===B.cur) return;
    busy=true;
    try{
      const oldL=document.getElementById("slotL");
      const oldR=document.getElementById("slotR");
      const source=(dir>0?oldR:oldL).firstElementChild;
      if(!source){ B.cur=target; B.rerender(); return; }

      const moving=source.cloneNode(true);
      const targetIndex=target;
      B.cur=targetIndex;
      B.rerender();

      const targetL=document.getElementById("slotL");
      const targetR=document.getElementById("slotR");
      const under=(dir>0?targetR:targetL);
      const backSource=(dir>0?targetL:targetR).firstElementChild;
      const back=backSource ? backSource.cloneNode(true) : document.createElement("div");
      if(dir>0) targetL.style.visibility="hidden"; else targetR.style.visibility="hidden";

      const sheet=document.createElement("div");
      sheet.className="metp-physical-sheet";
      sheet.style.cssText=[
        "position:absolute","top:0","height:100%","width:50%","z-index:20",
        "transform-style:preserve-3d","pointer-events:none","will-change:transform",
        "left:"+(dir>0?"50%":"0"),"transform-origin:"+(dir>0?"right":"left")+" center"
      ].join(";");
      const front=document.createElement("div");
      front.className="face";
      front.style.cssText="position:absolute;inset:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#faf5e8;";
      front.appendChild(moving);
      const backFace=document.createElement("div");
      backFace.className="face back";
      backFace.style.cssText="position:absolute;inset:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:#faf5e8;transform:rotateY(180deg);";
      backFace.appendChild(back);
      const shade=document.createElement("div");
      shade.className="metp-sheet-shade";
      shade.style.cssText="position:absolute;inset:0;background:#160b06;opacity:0;pointer-events:none;z-index:30;";
      front.appendChild(shade);
      sheet.append(front,backFace);
      spread.appendChild(sheet);

      const dur=820;
      let start=null;
      await new Promise(resolve=>{
        function frame(ts){
          if(start===null) start=ts;
          const p=Math.min(1,(ts-start)/dur);
          const e=1-Math.pow(1-p,3);
          const bow=Math.sin(e*Math.PI);
          const angle=dir>0?-180*e:180*e;
          sheet.style.transform="rotateY("+angle+"deg) translateZ("+(bow*18)+"px) skewY("+((dir>0?-1:1)*bow*.45)+"deg)";
          shade.style.opacity=String(Math.min(.58,bow*.55));
          if(p<1) requestAnimationFrame(frame); else resolve();
        }
        requestAnimationFrame(frame);
      });
      targetL.style.visibility="";
      targetR.style.visibility="";
      sheet.remove();
    }finally{
      busy=false;
    }
  }

  function intercept(el,fn){
    if(!el) return;
    el.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();fn();},true);
  }
  intercept(prev,()=>turn(B.cur-1,-1));
  intercept(next,()=>turn(B.cur+1,1));

  function peel(el,dir){
    if(!el) return;
    let downX=0,drag=false;
    el.addEventListener("pointerdown",e=>{
      if(busy)return;
      downX=e.clientX;drag=false;
      try{el.setPointerCapture(e.pointerId)}catch(_){}
    },true);
    el.addEventListener("pointermove",e=>{
      if(busy)return;
      const dx=e.clientX-downX;
      if(Math.abs(dx)>7)drag=true;
      if((dir>0&&dx<-38)||(dir<0&&dx>38)){
        el.dispatchEvent(new PointerEvent("metpturn",{bubbles:false}));
        turn(B.cur+dir,dir);
        downX=e.clientX+9999;
      }
    },true);
    el.addEventListener("click",e=>{
      if(drag){e.preventDefault();e.stopImmediatePropagation();}
    },true);
  }
  peel(peelR,1); peel(peelL,-1);

  function open(){
    if(B.opened||busy)return;
    busy=true;
    M.sound&&M.sound.open();
    lid.style.pointerEvents="none";
    binder.setAttribute("data-state","closed");
    lid.style.opacity="1";
    lid.style.transformOrigin="left center";
    const dur=900;let start=null;
    function frame(ts){
      if(start===null)start=ts;
      const p=Math.min(1,(ts-start)/dur);
      const e=1-Math.pow(1-p,3);
      lid.style.transform="rotateY("+(-178*e)+"deg)";
      if(p<1)requestAnimationFrame(frame);
      else{
        lid.style.opacity="0";
        B.opened=true;
        binder.setAttribute("data-state","open");
        busy=false;
      }
    }
    requestAnimationFrame(frame);
  }
  function close(){
    if(!B.opened||busy)return;
    busy=true;
    M.sound&&M.sound.close();
    lid.style.pointerEvents="none";
    lid.style.opacity="1";
    const dur=820;let start=null;
    function frame(ts){
      if(start===null)start=ts;
      const p=Math.min(1,(ts-start)/dur);
      const e=p*p*(3-2*p);
      lid.style.transform="rotateY("+(-178+178*e)+"deg)";
      if(p<1)requestAnimationFrame(frame);
      else{
        B.opened=false;
        binder.setAttribute("data-state","closed");
        lid.style.pointerEvents="";
        lid.setAttribute("tabindex","0");
        busy=false;
      }
    }
    requestAnimationFrame(frame);
  }
  intercept(lid,open);
  const lidOpen=document.getElementById("lidOpen");
  intercept(lidOpen,open);
  if(sticker) intercept(sticker,()=>close());
  window.addEventListener("keydown",e=>{
    if(e.target&&e.target.closest&&e.target.closest("input,textarea,[contenteditable]"))return;
    if(e.key==="ArrowRight"){e.preventDefault();turn(B.cur+1,1)}
    if(e.key==="ArrowLeft"){e.preventDefault();turn(B.cur-1,-1)}
  },true);
})();
