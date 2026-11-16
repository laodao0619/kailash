'use strict';
const consent=require('../lib/crm-consent-events');
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 const token=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 const admin=consent.authorized(token,process.env.KBI_ACCESS_TOKEN);
 if(req.method==='GET'){
  if(!admin)return res.status(401).json({ok:false,error:'unauthorized'});
  const meta=await consent.read(consent.META);return res.status(200).json({ok:true,connection:meta});
 }
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'method'});
 if(req.query?.setup==='1'){
  if(!admin)return res.status(401).json({ok:false,error:'unauthorized'});
  try{return res.status(200).json({ok:true,connection:await consent.connect()});}
  catch(e){console.error('CRM_CONSENT_SETUP',e.message);return res.status(503).json({ok:false,error:'consent_setup_failed'});}
 }
 try{
  const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>256000)return res.status(413).end();chunks.push(c);}
  await consent.ingest(Buffer.concat(chunks),req.headers);return res.status(200).json({ok:true});
 }catch(e){
  const invalid=['unexpected_webhook_source','invalid_webhook_signature'].includes(e.message);
  console.error('CRM_CONSENT_INGEST',invalid?'unauthorized':e.name==='SyntaxError'?'invalid_json':e.message);
  return res.status(invalid?401:503).json({ok:false,error:invalid?'unauthorized':'consent_event_not_persisted'});
 }
};
module.exports.config={api:{bodyParser:false}};
