"use strict";
const crypto = require("node:crypto");

const COOKIE = "__Host-kbi-session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;

function equal(left, right) {
 const digest = value => crypto.createHash("sha256").update(value).digest();
 return crypto.timingSafeEqual(digest(left), digest(right));
}

function sameOrigin(req) {
 return Boolean(req.headers?.host && req.headers.origin === "https://" + req.headers.host);
}

function signature(expires) {
 return crypto.createHmac("sha256", process.env.KBI_SESSION_SECRET)
  .update(JSON.stringify([COOKIE, expires, process.env.KBI_SHARED_PASSWORD]))
  .digest("base64url");
}

function sessionCookie() {
 const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
 return `${COOKIE}=${expires}.${signature(expires)}; Max-Age=${SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

function hasSession(req) {
 if (!process.env.KBI_SHARED_PASSWORD || !(process.env.KBI_SESSION_SECRET?.length >= 32)) return false;
 if (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req)) return false;
 const cookie = (req.headers?.cookie || "").split(";").map(value => value.trim())
  .find(value => value.startsWith(COOKIE + "="));
 const match = cookie?.slice(COOKIE.length + 1).match(/^(\d{1,12})\.([\w-]{43})$/);
 return Boolean(match && Number(match[1]) > Math.floor(Date.now() / 1000)
  && equal(match[2], signature(match[1])));
}

function loginReady() {
 return Boolean(process.env.KBI_SHARED_PASSWORD && process.env.KBI_SESSION_SECRET?.length >= 32
  && process.env.KBI_RATE_LIMIT_REDIS_URL && process.env.KBI_RATE_LIMIT_REDIS_TOKEN);
}

async function countAttempt(ip) {
 const key = "kbi:login:" + crypto.createHash("sha256").update(ip).digest("hex");
 const script = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return {n, redis.call('TTL', KEYS[1])}";
 const response = await fetch(process.env.KBI_RATE_LIMIT_REDIS_URL, {
  method: "POST",
  headers: {Authorization: "Bearer " + process.env.KBI_RATE_LIMIT_REDIS_TOKEN, "Content-Type": "application/json"},
  body: JSON.stringify(["EVAL", script, 1, key, WINDOW_SECONDS]),
  signal: AbortSignal.timeout(3000)
 });
 if (!response.ok) throw Error("Login rate limiter unavailable");
 const {result} = await response.json();
 if (!Array.isArray(result) || !result.every(Number.isInteger) || result.length !== 2) {
  throw Error("Invalid login rate limiter response");
 }
 return result[0] > MAX_ATTEMPTS ? Math.max(result[1], 1) : 0;
}

module.exports = {equal, sameOrigin, sessionCookie, hasSession, loginReady, countAttempt};
