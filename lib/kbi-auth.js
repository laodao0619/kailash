"use strict";

const DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH=8;
function minimumKbiTokenLength(env=process.env){
 const configured=Number(env.KBI_ACCESS_TOKEN_MIN_LENGTH);
 return Number.isInteger(configured)&&configured>=1?configured:DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH;
}
function isKbiTokenConfigured(token=process.env.KBI_ACCESS_TOKEN,env=process.env){
 return typeof token==="string"&&token.length>=minimumKbiTokenLength(env);
}
module.exports={DEFAULT_KBI_ACCESS_TOKEN_MIN_LENGTH,minimumKbiTokenLength,isKbiTokenConfigured};
