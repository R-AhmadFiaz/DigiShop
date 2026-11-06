import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedPostings, signedBalance} from '../dist/utils/businessAccounting.js';
import {moneyMinor} from '../dist/utils/invoiceAccounting.js';
const a = '000000000000000000000001', b = '000000000000000000000002';
const rows = amount => [{accountId:a,debitMinor:amount,creditMinor:0},{accountId:b,debitMinor:0,creditMinor:amount}];
test('journal balances integer paisa and reuses strict existing PKR conversion', () => {
    assert.equal(moneyMinor(12.34),1234); assert.equal(moneyMinor(0.1+0.2),30);
    assert.equal(balancedPostings(rows(1234)).length,2);
    assert.throws(()=>moneyMinor(1.234));
});
test('journal rejects fractional, negative, unsafe, unbalanced and empty money', () => {
    for(const amount of [0,-1,1.2,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>balancedPostings(rows(amount)));
    const input=rows(10);input[1].creditMinor=9;assert.throws(()=>balancedPostings(input));
    assert.throws(()=>balancedPostings([]));
});
test('journal rejects duplicate accounts, invalid identity and two-sided rows', () => {
    const input=rows(10);input[1].accountId=a;assert.throws(()=>balancedPostings(input));
    input[1].accountId='bad';assert.throws(()=>balancedPostings(input));
    input[1].accountId=b;input[0].creditMinor=1;assert.throws(()=>balancedPostings(input));
});
test('balances use exact bigint arithmetic and enforce safe signed output', () => {
    assert.equal(signedBalance(50n,80n,'CREDIT'),30);
    assert.equal(signedBalance(50n,80n,'DEBIT'),-30);
    assert.throws(()=>signedBalance(BigInt(Number.MAX_SAFE_INTEGER)+1n,0n,'DEBIT'));
    const input=rows(Number.MAX_SAFE_INTEGER);input.push({accountId:'000000000000000000000003',debitMinor:1,creditMinor:0},{accountId:'000000000000000000000004',debitMinor:0,creditMinor:1});assert.throws(()=>balancedPostings(input));
});
