"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/bi-session");
const {hasSession} = require("../lib/kbi-session");

test("shared-password login issues a persistent cookie and enforces server-side limits", async t => {
 const password = "test-password";
 const config = {
  KBI_SHARED_PASSWORD: password,
  KBI_SESSION_SECRET: "test-signing-key".repeat(3),
  KBI_RATE_LIMIT_REDIS_URL: "https://redis.example.test",
  KBI_RATE_LIMIT_REDIS_TOKEN: "test-redis-token"
 };
 for (const [key, value] of Object.entries(config)) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
 }
 let attempts = 0;
 t.mock.method(globalThis, "fetch", async (_url, options) => {
  const [command, , keyCount, , window] = JSON.parse(options.body);
  assert.deepEqual([command, keyCount, window], ["EVAL", 1, 900]);
  return Response.json({result: [++attempts, 900]});
 });

 const headers = {host:"bi.example.test", origin:"https://bi.example.test", "x-vercel-forwarded-for":"192.0.2.1"};
 async function call(method, requestHeaders, submittedPassword) {
  const result = {headers:{}};
  const res = {
   setHeader(name, value) { result.headers[name] = value; },
   status(code) { result.status = code; return this; },
   json(body) { result.body = body; return this; }
  };
  await handler({method, headers:requestHeaders, body:{password:submittedPassword}}, res);
  return result;
 }

 assert.equal((await call("POST", {...headers, origin:"https://other.example.test"}, password)).status, 403);
 assert.equal((await call("POST", headers, "incorrect")).status, 401);
 const login = await call("POST", headers, password);
 assert.equal(login.status, 200);
 const setCookie = login.headers["Set-Cookie"];
 assert.match(setCookie, /; Max-Age=604800; Path=\/; Secure; HttpOnly; SameSite=Strict$/);
 const cookie = setCookie.split(";")[0];
 assert.equal((await call("GET", {cookie})).body.authenticated, true);
 assert.equal((await call("GET", {cookie:cookie + "x"})).body.authenticated, false);
 assert.equal(hasSession({method:"PUT", headers:{...headers, cookie}}), true);
 assert.equal(hasSession({method:"PUT", headers:{cookie}}), false);

 attempts = 10;
 const limited = await call("POST", headers, password);
 assert.equal(limited.status, 429);
 assert.equal(limited.headers["Retry-After"], 900);
 assert.equal(limited.headers["Set-Cookie"], undefined);

 const now = Date.now();
 const clock = t.mock.method(Date, "now", () => now + 604800000);
 assert.equal((await call("GET", {cookie})).body.authenticated, false);
 clock.mock.restore();
 process.env.KBI_SHARED_PASSWORD = "rotated-test-password";
 assert.equal((await call("GET", {cookie})).body.authenticated, false);
});

test("login fails closed when rate limiting is unavailable or unconfigured", async t => {
 const password = "fixture-password";
 const config = {
  KBI_SHARED_PASSWORD: password,
  KBI_SESSION_SECRET: "fixture-signing-key".repeat(3),
  KBI_RATE_LIMIT_REDIS_URL: "https://redis.example.test",
  KBI_RATE_LIMIT_REDIS_TOKEN: "fixture-redis-token"
 };
 for (const [key, value] of Object.entries(config)) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
 }
 const headers = {host:"bi.example.test", origin:"https://bi.example.test", "x-vercel-forwarded-for":"192.0.2.2"};
 let calls = 0;
 let redis = async () => Response.json({result:[1,900]});
 t.mock.method(globalThis, "fetch", async () => { calls++; return redis(); });
 async function call(requestHeaders=headers) {
  const result = {headers:{}};
  const res = {
   setHeader(name,value) { result.headers[name]=value; },
   status(code) { result.status=code; return this; },
   json(body) { result.body=body; return this; }
  };
  await handler({method:"POST", headers:requestHeaders, body:{password}},res);
  return result;
 }
 function unavailable(result, reason) {
  assert.equal(result.status,503);
  assert.deepEqual(result.body,{ok:false,error:reason});
  assert.equal(result.headers["Set-Cookie"],undefined);
 }
 delete process.env.KBI_RATE_LIMIT_REDIS_TOKEN;
 unavailable(await call(),"login_not_configured");
 assert.equal(calls,0);
 process.env.KBI_RATE_LIMIT_REDIS_TOKEN=config.KBI_RATE_LIMIT_REDIS_TOKEN;
 unavailable(await call({...headers,"x-vercel-forwarded-for":"invalid-address"}),"login_unavailable");
 assert.equal(calls,0);
 redis=async()=>new Response(null,{status:503});
 unavailable(await call(),"login_unavailable");
 redis=async()=>Response.json({result:[1,"900"]});
 unavailable(await call(),"login_unavailable");
 redis=async()=>{throw new Error("simulated rate-limiter connection failure");};
 unavailable(await call(),"login_unavailable");
 assert.equal(calls,3);
 redis=async()=>Response.json({result:[1,900]});
 const recovered=await call();
 assert.equal(recovered.status,200);
 assert.ok(recovered.headers["Set-Cookie"]);
});
