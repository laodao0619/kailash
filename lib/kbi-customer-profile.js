"use strict";
/**
 * Evidence-led product-interest tags. Only derive from known purchased product
 * titles, never from customer addresses, religion, socioeconomic status, or
 * private social profiles. Tags are *observed purchase patterns*.
 */
const TOKENS=[
 {key:"Vajra",pattern:/\bvajra\b/i},
 {key:"Thokcha",pattern:/\bthokcha\b|sky.iron/i},
 {key:"Zakiram",pattern:/\bzakiram\b/i},
 {key:"Lotus",pattern:/\blotus\b/i},
 {key:"Mala",pattern:/\bmala\b/i},
 {key:"Turquoise",pattern:/\bturquoise\b/i},
 {key:"Obsidian",pattern:/\bobsidian\b/i},
 {key:"Amethyst",pattern:/\bamethyst\b/i},
 {key:"Woven",pattern:/\bwoven\b|hand.braided|macram[eé]/i},
 {key:"Protection",pattern:/\bprotection\b/i}
];
function productTags(orders){
 const scores=new Map();
 for(const order of orders||[]){
  if(order?.kind!=="order"||order.validForReview!==true)continue;
  const productList=Array.isArray(order.products)?order.products:[];
  for(const item of productList){
   const name=String(item?.title||"");
   const quantity=Number(item?.quantity);
   if(!name||!Number.isInteger(quantity)||quantity<=0)continue;
   for(const tag of TOKENS){
    if(!tag.pattern.test(name))continue;
    const prev=scores.get(tag.key)||{tag:tag.key,observedOrders:new Set(),quantity:0,evidence:[]};
    prev.observedOrders.add(order.orderId);
    prev.quantity+=quantity;
    if(prev.evidence.length<5)prev.evidence.push({orderId:order.orderId,productTitle:name});
    scores.set(tag.key,prev);
   }
  }
 }
 return [...scores.values()].map(v=>({
  label:v.tag,source:"purchase_title_keyword",
  evidenceCount:v.observedOrders.size,quantity:v.quantity,
  evidence:v.evidence,confidence:"observed_keyword_only",
  verifiedPreference:false
 })).sort((a,b)=>b.evidenceCount-a.evidenceCount||a.label.localeCompare(b.label));
}
module.exports={productTags,TOKENS};
