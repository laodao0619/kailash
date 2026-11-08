'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,validItem}=require('../lib/kbi-board');
const {queryBatch,dateRange}=require('../lib/kbi-ops-analytics');
test('all ten analytics reports use the exact inclusive selected range and reject injection/invalid calendar dates',()=>{
 const q=queryBatch(dateRange('2026-11-01','2026-11-08'));
 assert.equal((q.match(/SINCE 2026-11-01 UNTIL 2026-11-08/g)||[]).length,10);
 for(const args of [['2026-02-30','2026-03-01'],['2026-11-09','2026-11-01'],['2026-01-01 SHOW orders','2026-11-01'],['2024-01-01','2026-11-01']])assert.throws(()=>dateRange(...args));
});
test('editable text goals allow qualitative profit target without an invented number',()=>{
 const d=defaults();assert(d.items.every(validItem));
 assert.equal(d.items[0].title,'当前月 GMV 目标：$100,000');
 assert.equal(d.items[1].title,'最近一周目标：毛利润转正');
 assert(validItem({...d.items[1],notes:'责任人及执行记录',done:true,priority:false}));
 assert(!validItem({...d.items[1],done:'true'}));
 assert(!validItem({...d.items[1],title:''}));
});
test('board enforces auth, preserves concurrent edits with etag, allows edit/delete, and reports version conflicts',async()=>{
 const blob=require('@vercel/blob');const get=blob.get,put=blob.put;
 // Exported SDK uses accessor properties; inject a module into require cache for isolated handler testing.
 const sdkPath=require.resolve('@vercel/blob'),original=require.cache[sdkPath].exports;
 let stored=null,etag='1',writes=0;
 require.cache[sdkPath].exports={get:async()=>stored?{statusCode:200,blob:{etag},stream:[Buffer.from(JSON.stringify(stored))]}:null,put:async(path,value,options)=>{
  if(stored)assert.equal(options.ifMatch,etag);else assert.equal(options.allowOverwrite,false);
  writes++;stored=JSON.parse(value);etag=String(Number(etag)+1);
 }};
 delete require.cache[require.resolve('../api/bi-ops-board')];
 const handler=require('../api/bi-ops-board'),previous=process.env.KBI_ACCESS_TOKEN;process.env.KBI_ACCESS_TOKEN='x'.repeat(32);
 async function call(method,body,auth=true){const res={setHeader(){},status(n){this.code=n;return this},json(d){this.data=d;return this}};await handler({method,body,headers:auth?{authorization:'Bearer '+'x'.repeat(32)}:{}},res);return res;}
 try{
  assert.equal((await call('GET',null,false)).code,401);
  let r=await call('GET');assert.equal(r.data.items.length,2);
  r=await call('POST',{action:'save',expectedVersion:0,item:{...defaults().items[0],done:true,notes:'已复盘'}});assert.equal(r.code,200);
  assert.equal((await call('POST',{action:'save',expectedVersion:0,item:defaults().items[0]})).code,409);
  r=await call('POST',{action:'delete',expectedVersion:1,id:'goal-week'});assert.equal(r.code,200);assert.equal(writes,2);
  r=await call('GET');assert.equal(r.data.items.length,1);assert.equal(r.data.items[0].notes,'已复盘');assert.equal(r.data.items[0].done,true);
 }finally{require.cache[sdkPath].exports=original;if(previous===undefined)delete process.env.KBI_ACCESS_TOKEN;else process.env.KBI_ACCESS_TOKEN=previous;}
});
