"use strict";
(function(root,factory){
 const lib=factory();
 if(typeof module==="object"&&module.exports)module.exports=lib;
 else root.KBITimeline=lib;
})(typeof window!=="undefined"?window:undefined,function(){
 const DAY=86400000,MIN=DAY,MAX=10*365*DAY;
 function millis(v){const t=typeof v==="number"?v:Date.parse(v);return Number.isFinite(t)?t:null;}
 function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
 function allBounds(events,now=Date.now()){
  const stamps=(events||[]).map(e=>millis(e.at)).filter(t=>t!==null);
  const min=stamps.length?Math.min(...stamps):now-30*DAY;
  const max=stamps.length?Math.max(...stamps):now;
  return {start:Math.min(min,now)-DAY,end:Math.max(max,now)+DAY};
 }
 function timeWindow(events,preset,now=Date.now(),customStart="",customEnd=""){
  const bounds=allBounds(events,now);
  if(preset==="all")return {start:bounds.start,end:bounds.end,preset:"all"};
  if(preset==="custom"){
   const start=millis(customStart),end=millis(customEnd);
   if(start!==null&&end!==null&&end>=start)return {
    start,end:end+DAY-1,preset:"custom"};
   return {start:now-180*DAY,end:now,preset:"180"};
  }
  const days=[30,60,180,360].includes(Number(preset))?Number(preset):180;
  return {start:now-days*DAY,end:now,preset:String(days)};
 }
 function zoom(window,delta,ratio=.5,bounds){
  if(!window||!Number.isFinite(window.start)||!Number.isFinite(window.end))return window;
  const width=Math.max(MIN,window.end-window.start);
  const size=clamp(width*Math.exp(Math.sign(delta)*.23),MIN,MAX);
  const r=clamp(Number(ratio)||0,.04,.96);
  const focus=window.start+width*r;
  let start=focus-size*r,end=start+size;
  if(bounds){
   if(start<bounds.start){end+=bounds.start-start;start=bounds.start;}
   if(end>bounds.end){start-=end-bounds.end;end=bounds.end;}
   if(bounds.end-bounds.start<size){start=bounds.start;end=bounds.end;}
   start=Math.max(bounds.start,start);end=Math.min(bounds.end,end);
  }
  return {start,end,preset:"zoom"};
 }
 function filterEvents(events,window){
  return (events||[]).filter(e=>{
   const t=millis(e.at);return t!==null&&t>=window.start&&t<=window.end;
  }).sort((a,b)=>millis(a.at)-millis(b.at));
 }
 function cumulativeSeries(events,fn){
  let count=0;
  return [...(events||[])].sort((a,b)=>millis(a.at)-millis(b.at)).map(e=>{
   count+=Number(fn(e))||0;
   return {at:e.at,value:count,source:e};
  });
 }
 function polyline(items,x,y){
  return (items||[]).map((item,i)=>(i?"L":"M")+x(item).toFixed(2)+" "+y(item).toFixed(2)).join("");
 }
 return {DAY,MIN,MAX,millis,clamp,allBounds,timeWindow,zoom,filterEvents,cumulativeSeries,polyline};
});
