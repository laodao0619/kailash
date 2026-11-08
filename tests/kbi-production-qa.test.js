"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {sorted}=require("../api/bi-production-qa");
test("production sanity check verifies descending and ascending full-result order",()=>{
 assert.equal(sorted([{m180:3200},{m180:900},{m180:10},{m180:null}],"m180","desc"),true);
 assert.equal(sorted([{m180:900},{m180:3200}],"m180","desc"),false);
 assert.equal(sorted([{m180:10},{m180:900}],"m180","asc"),true);
 assert.equal(sorted([{m180:10},{m180:900}],"m180","desc"),false);
});
