import {createHash,randomUUID} from 'node:crypto';
import {BusinessSetup} from '../models/businessSetup.model.js';
import {businessTransaction} from '../utils/businessAccounts.js';
import {normalizeSetup,setupEvidence,applySetup,setupText} from '../utils/existingBusinessSetup.js';
import {invoiceAccountingEnabled} from '../utils/invoiceAccountingIntegration.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';

export const existingSetup=(operation:string)=>asyncHandler(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');const actor=req.user,body=req.body??{};
    const data=await businessTransaction(actor,async session=>{
        let setup=await BusinessSetup.findOne({shopId:actor.shopId}).session(session);
        if(operation==='view'){
            // Confirmed evidence is historical, not silently recomputed from today's stock.
            return {setup:setup??null,evidence:setup?.state==='CONFIRMED'?setup.review?.evidence:await setupEvidence(actor,setup?.input??null,session)};
        }
        if(operation==='confirm'){
            if(!invoiceAccountingEnabled())throw new apiError(409,'Financial setup confirmation requires test-only accounting');
            const requestKey=setupText(body.requestKey,100);
            if(!/^[\w-]{8,100}$/.test(requestKey)||body.confirmation!=='CONFIRM EXISTING BUSINESS SETUP')throw new apiError(400,'Type CONFIRM EXISTING BUSINESS SETUP to acknowledge irreversible openings');
            const requestHash=createHash('sha256').update(JSON.stringify({actor:String(actor._id),expectedRevision:body.expectedRevision,previewToken:body.previewToken,confirmation:body.confirmation,requestKey})).digest('hex');
            if(setup?.state==='CONFIRMED'){
                if(setup.requestKey===requestKey&&setup.requestHash===requestHash)return {setup,replayed:true};
                throw new apiError(409,'Existing business setup is already confirmed; openings cannot be reset');
            }
            if(!setup||setup.get('revision')!==body.expectedRevision||!setup.review||setup.review.token!==body.previewToken||+new Date(setup.review.expiresAt)<=Date.now())throw new apiError(409,'Setup changed or preview expired; review again');
            const evidence=await setupEvidence(actor,setup.input,session);
            if(evidence.digest!==setup.review.evidence.digest)throw new apiError(409,'Shop records changed after preview; review again before confirming');
            if(evidence.blockers.length)throw new apiError(409,'Setup has unresolved items; review the blockers before confirming');
            const accounts=await applySetup(actor,setup,evidence,session);
            setup.state='CONFIRMED';setup.requestKey=requestKey;setup.requestHash=requestHash;setup.confirmedBy=actor._id;setup.confirmedByName=actor.username;setup.confirmedAt=new Date();setup.updatedBy=actor._id;
            setup.review={...setup.review,evidence:{...evidence,inventoryStatus:'COMPLETE',cash:evidence.cash.map(r=>({...r,status:'COMPLETE'})),suppliers:evidence.suppliers.map(r=>({...r,status:'COMPLETE'}))},accounts,confirmedAt:setup.confirmedAt};setup.markModified('review');await setup.save({session});return {setup,replayed:false};
        }
        if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new apiError(400,'Current draft revision required');
        if(setup?.state==='CONFIRMED')throw new apiError(409,'Confirmed setup is immutable; do not recreate openings');
        if(setup&&setup.get('revision')!==body.expectedRevision)throw new apiError(409,'Setup draft changed; reload before editing');
        if(operation==='save'){
            const input=normalizeSetup(body.input);
            if(!setup){if(body.expectedRevision!==0)throw new apiError(409,'Reload setup');setup=new BusinessSetup({shopId:actor.shopId,input,createdBy:actor._id,updatedBy:actor._id});}
            else{setup.input=input;setup.markModified('input');setup.review=undefined;setup.updatedBy=actor._id;}
            await setup.save({session});return {setup,evidence:await setupEvidence(actor,input,session)};
        }
        if(!setup)throw new apiError(400,'Save the setup draft first');
        const evidence=await setupEvidence(actor,setup.input,session);
        setup.review={token:randomUUID(),expiresAt:new Date(Date.now()+5*60000),evidence};setup.markModified('review');await setup.save({session});
        return {setup,evidence,previewToken:setup.review.token,expectedRevision:setup.get('revision')};
    },operation!=='view');
    res.json(new apiResponse(200,data,'Existing business setup request completed'));
});
