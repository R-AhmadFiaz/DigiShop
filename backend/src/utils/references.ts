import mongoose from 'mongoose';
import {Shop} from '../models/shop.model.js';
import {apiError} from './apiError.js';

// Counters live on the existing shop document: a transaction write conflict serializes
// competing allocations. Never infer a number from record counts or client input.
export async function nextReference(shopId:any, prefix:string, model:mongoose.Model<any>, session?:mongoose.ClientSession, field='reference', legacyPrefixes:string[]=[]):Promise<string> {
    if(!/^[A-Z]{2,4}$/.test(prefix))throw new apiError(500,'Invalid reference type');
    if(!session){
        const own=await mongoose.startSession();
        try{return await own.withTransaction(()=>nextReference(shopId,prefix,model,own,field,legacyPrefixes));}
        finally{await own.endSession();}
    }
    if(!session.inTransaction())throw new apiError(500,'Reference allocation requires a transaction');
    const shop=await Shop.findById(shopId).session(session);
    if(!shop)throw new apiError(404,'Shop not found');
    const counterPath='referenceCounters.'+prefix;
    if(shop.referenceCounters?.get(prefix)===undefined){
        let maximum=0;
        const pattern=new RegExp('^(?:'+[prefix,...legacyPrefixes].join('|')+')-(\\d+)$');
        const existing=await model.find({shopId,[field]:pattern}).select(field).session(session).lean();
        for(const row of existing){const n=Number(String((row as any)[field]).match(pattern)![1]);if(!Number.isSafeInteger(n))throw new apiError(409,'Existing reference numbering requires review');maximum=Math.max(maximum,n);}
        // Retain the old durable purchase counters even if older records were removed.
        if(prefix==='PO')maximum=Math.max(maximum,shop.purchaseCounter??0);
        if(prefix==='GR')maximum=Math.max(maximum,shop.receiptCounter??0);
        if(prefix==='INV')maximum=Math.max(maximum,shop.invoiceCounter??0);
        await Shop.updateOne({_id:shopId},{$set:{[counterPath]:maximum}},{session});
    }
    for(let attempt=0;attempt<1000;attempt++){
        const result=await Shop.findOneAndUpdate({_id:shopId},{$inc:{[counterPath]:1}},{session,new:true});
        const number=result?.referenceCounters?.get(prefix);
        if(!Number.isSafeInteger(number)||number!<=0)throw new apiError(409,'Reference numbering requires review');
        const reference=prefix+'-'+number;
        if(!await model.exists({shopId,[field]:reference}).session(session)){
            if(prefix==='INV')await Shop.updateOne({_id:shopId},{$max:{invoiceCounter:number}},{session});
            return reference;
        }
    }
    throw new apiError(409,'Existing references require review');
}

// New records only; never backfill or rewrite historical immutable documents.
export function automaticReference(schema:mongoose.Schema, prefix:(document:any)=>string|undefined, field='reference'){
    if(!schema.path(field))schema.add({[field]:{type:String}});
    schema.add({referenceIssued:{type:Boolean}});
    if(!schema.indexes().some(([keys,options])=>options.unique&&Object.keys(keys).length===2&&keys.shopId===1&&keys[field]===1))
        schema.index({shopId:1,[field]:1},{name:'issued_'+field,unique:true,partialFilterExpression:{referenceIssued:true}});
    schema.pre('save',async function(){
        const document=this as any,kind=prefix(document);
        if(document.isNew&&kind){
            if(!document.get(field))document.set(field,await nextReference(document.shopId,kind,document.constructor,document.$session()??undefined,field));
            else {
                if(await document.constructor.exists({shopId:document.shopId,[field]:document.get(field)}).session(document.$session()??null))throw new apiError(409,'Reference already exists in this shop');
                const match=String(document.get(field)).match(new RegExp('^'+kind+'-(\\d+)$'));
                if(match){
                    const number=Number(match[1]);
                    if(!Number.isSafeInteger(number))throw new apiError(400,'Reference number exceeds safe range');
                    await Shop.updateOne({_id:document.shopId},{$max:{['referenceCounters.'+kind]:number}},{session:document.$session()??undefined});
                }
            }
            document.set('referenceIssued',true);
        }
    });
}
