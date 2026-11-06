import {asyncHandler} from '../utils/asyncHandler.js';
import {apiResponse} from '../utils/apiResponse.js';
import {businessTransaction} from '../utils/businessAccounts.js';
import {apiError} from '../utils/apiError.js';
import {createPurchase,changePurchaseState,receivePurchase,getPurchase,listPurchases} from '../utils/purchases.js';

export const purchaseOperation=(operation:'CREATE'|'LIST'|'VIEW'|'CONFIRM'|'CANCEL'|'RECEIVE'|'RECEIPTS')=>asyncHandler(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const write=!['LIST','VIEW','RECEIPTS'].includes(operation);
    if(write&&['paidAmount','paymentAmount','cashAmount','creditAmount','receiptAccountId','refundAccountId','paymentAccountId','cashAccountId','bankAccountId','accountId','payments'].some(k=>req.body?.[k]!==undefined))throw new apiError(400,'Supplier payments are not supported; do not submit payment or cash-account fields');
    const data=await businessTransaction(req.user,async session=>{
        const id=req.params.id as string;
        switch(operation){
            case 'CREATE':return createPurchase(req.user,req.body??{},session);
            case 'LIST':return listPurchases(req.user,req.query,session);
            case 'VIEW':return getPurchase(req.user,id,session);
            case 'CONFIRM':return changePurchaseState(req.user,id,req.body??{},'CONFIRM',session);
            case 'CANCEL':return changePurchaseState(req.user,id,req.body??{},'CANCEL',session);
            case 'RECEIVE':return receivePurchase(req.user,id,req.body??{},session);
            case 'RECEIPTS':return listPurchases(req.user,req.query,session,id);
        }
    },write);
    res.status(200).json(new apiResponse(200,data,'Success'));
});
