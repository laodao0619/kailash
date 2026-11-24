"use strict";
const {isIP} = require("node:net");
const {equal, sameOrigin, sessionCookie, hasSession, loginReady, countAttempt} = require("../lib/kbi-session");

module.exports = async (req, res) => {
 res.setHeader("Cache-Control", "private, no-store");
 res.setHeader("X-Content-Type-Options", "nosniff");
 if (req.method === "GET") return res.status(200).json({ok:true, authenticated:hasSession(req)});
 if (req.method !== "POST") return res.status(405).json({ok:false, error:"method"});
 if (!sameOrigin(req)) return res.status(403).json({ok:false, error:"origin"});
 if (!loginReady()) return res.status(503).json({ok:false, error:"login_not_configured"});

 const ip = req.headers["x-vercel-forwarded-for"] || req.socket?.remoteAddress;
 try {
  if (typeof ip !== "string" || !isIP(ip)) throw Error("Client address unavailable");
  const retryAfter = await countAttempt(ip);
  if (retryAfter) {
   res.setHeader("Retry-After", retryAfter);
   return res.status(429).json({ok:false, error:"too_many_attempts"});
  }
 } catch {
  return res.status(503).json({ok:false, error:"login_unavailable"});
 }

 const password = req.body?.password;
 if (typeof password !== "string" || password.length > 1024 || !equal(password, process.env.KBI_SHARED_PASSWORD)) {
  return res.status(401).json({ok:false, error:"invalid_password"});
 }
 res.setHeader("Set-Cookie", sessionCookie());
 return res.status(200).json({ok:true, authenticated:true});
};
