'use strict';
const {authorized}=require('../lib/kbi-board');
const {inspectGoogleAccount}=require('../lib/google-ads');
const {safeError}=require('../lib/ads-common');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(401).json({ok:false,error:'unauthorized'});
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'method'});
 if(req.query?.google_actions==='1'){
  if(process.env.GOOGLE_ADS_ACCESS_APPROVED!=='true')return res.status(409).json({ok:false,error:'google_api_approval_pending'});
  try{const {customer,actions}=await inspectGoogleAccount({signal:AbortSignal.timeout(30000)});return res.status(200).json({ok:true,customer,actions,note:'Read-only inventory. Explicitly confirm PURCHASE IDs before setting GOOGLE_ADS_PURCHASE_ACTION_IDS.'});}
  catch(e){return res.status(502).json({ok:false,error:safeError(e)});}
 }
 const keys=['META_SYSTEM_USER_TOKEN','META_AD_ACCOUNT_IDS','META_GRAPH_API_VERSION','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN','GOOGLE_ADS_CUSTOMER_ID','GOOGLE_ADS_API_VERSION','GOOGLE_ADS_ACCESS_APPROVED','GOOGLE_ADS_LOGIN_CUSTOMER_ID','GOOGLE_ADS_PURCHASE_ACTION_IDS'];
 return res.status(200).json({ok:true,configured:Object.fromEntries(keys.map(k=>[k,!!process.env[k]])),googleAccessApproved:process.env.GOOGLE_ADS_ACCESS_APPROVED==='true',managerAccountStatus:process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?'login_customer_id_configured_not_verified':'unknown_optional_for_direct_account_access',note:'No credentials returned. Current Google API access is approved per Cloud project; MCC existence is not inferred.'});
};
