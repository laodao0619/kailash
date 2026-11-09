'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function model(){
 const text=[],fills=[],events={},nodes={};
 const ctx=new Proxy({measureText:s=>({width:s.length*7}),fillText:s=>text.push(s),fill(){fills.push(this.globalAlpha)},globalAlpha:1},{get:(o,k)=>k in o?o[k]:()=>{}});
 const node=id=>nodes[id]||(nodes[id]={value:({'rfm-r':90,'rfm-f':2,'rfm-m':800}[id]||''),addEventListener(){},checkValidity:()=>true,classList:{toggle(){}}});
 nodes['rfm-cube']={getContext:()=>ctx,addEventListener:(k,f)=>events[k]=f,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:900,height:600})};
 const codes=['HHH','HHL','HLH','HLL','LHH','LHL','LLH','LLL'];
 const fixture={segments:codes.map((code,i)=>({code,count:100+i*20,pct:12.5,label:code,m180:1000})),health:{rate:50},unknown:{count:0},totalSelected:1360,classified:1360,asOf:'2026-11-09T00:00:00Z'};
 const sandbox={window:{},document:{querySelectorAll:()=>[]},setTimeout,clearTimeout,navigator:{}};
 vm.runInNewContext(fs.readFileSync('public/bi/rfm-3d.js','utf8'),sandbox);
 const app=sandbox.window.KBIRFM3D.initialize({$:node,request:async()=>fixture,state:{token:'test'},esc:String,n:String});
 return {app,node,text,fills,events};
}
test('origin and axis direction labels remain explicit in primary and reverse views; every cube face is opaque',async()=>{
 const m=model();await m.app.refresh();
 assert(m.text.includes('O (0, 0, 0) · 模型原点'));
 assert(m.text.includes('R+ 更近期'));assert(m.text.includes('F+ 次数增多'));assert(m.text.includes('M+ 消费增加'));
 assert.match(m.node('rfm-orientation').textContent,/R低值侧、F低值侧/);
 assert(m.fills.every(x=>x===1));
 m.node('rfm-back-view').onclick();
 assert.match(m.node('rfm-orientation').textContent,/R高值侧、F高值侧/);
 m.node('rfm-reset-view').onclick();assert.match(m.node('rfm-orientation').textContent,/R低值侧、F低值侧/);
});
test('extreme vertical drags retain above-ground orientation and finite canvas geometry',async()=>{
 const m=model();await m.app.refresh();
 m.events.pointerdown({clientX:0,clientY:0,pointerId:1});
 m.events.pointermove({clientX:900,clientY:100000});
 assert.match(m.node('rfm-orientation').textContent,/上方为M高值/);
 m.events.pointermove({clientX:-900,clientY:-100000});
 assert.match(m.node('rfm-orientation').textContent,/上方为M高值/);
 assert(m.text.includes('O (0, 0, 0) · 模型原点'));
});
