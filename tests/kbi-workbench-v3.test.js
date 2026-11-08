"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const html=fs.readFileSync(require("node:path").join(__dirname,"../public/bi/index.html"),"utf8");
const modules=fs.readFileSync(require("node:path").join(__dirname,"../public/bi/workbench-modules.js"),"utf8");
const timeline=fs.readFileSync(require("node:path").join(__dirname,"../public/bi/timeline-range.js"),"utf8");
test("all eight final-target modules are navigable and have live content containers",()=>{
 for(const id of ["overview","customers","rfm","case-center","product-center","marketing-center","reports-center","operations"]){
  assert(html.includes('href="#'+id+'"'),"navigation "+id);
  assert(html.includes('id="'+id+'"'),"module "+id);
 }
 for(const id of ["rfm-bars","case-rows","catalog-grid","report-content","system-health","operation-status"]){
  assert(html.includes('id="'+id+'"'),"usable content "+id);
 }
 assert(modules.includes('"/api/bi-workbench-summary"'));
 assert(modules.includes('"/api/bi-workbench-cases"'));
 assert(modules.includes('"/api/bi-workbench-products"'));
});
test("customer360 has preset and custom date controls, wheel zoom and connected series",()=>{
 for(const v of ["30","60","180","360","all","custom"])
  assert(html.includes('data-range="'+v+'"'));
 for(const id of ["timeline-start","timeline-end","timeline-apply","timeline-zoom-in","timeline-zoom-out","journey-svg"])
  assert(html.includes('id="'+id+'"'));
 assert(html.includes('addEventListener("wheel"'));
 assert(html.includes('chartPath('));
 assert(html.includes('timelineState.view'));
 assert(timeline.includes("function zoom("));
});
test("user-facing product, case, RFM and report modules have actionable handlers",()=>{
 for(const id of ["marketing-find","case-search","case-refresh","product-search-btn","report-export","report-rfm","report-cases"])
  assert(html.includes('id="'+id+'"'),id);
 for(const hook of ['$("marketing-find").onclick','$("case-search").onclick','$("product-search-btn").onclick',
  '$("report-export").onclick','$("report-rfm").onclick','$("report-cases").onclick'])
  assert(modules.includes(hook),hook);
});
