"use strict";

// Keep readiness and all protected BI APIs on the same fail-closed floor.
// Changing an environment variable must never weaken the required minimum.
const DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH=24;
function minimumKbiTokenLength(env=process.env){
 const configured=Number(env.KBI_ACCESS_TOKEN_MIN_LENGTH);
 return Number.isInteger(configured)&&configured>=DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH
  ? configured : DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH;
}
function isKbiTokenConfigured(token=process.env.KBI_ACCESS_TOKEN,env=process.env){
 return typeof token==="string"&&token.length>=minimumKbiTokenLength(env);
}
module.exports={DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH,minimumKbiTokenLength,isKbiTokenConfigured};
