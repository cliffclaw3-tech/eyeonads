import test from 'node:test';
import assert from 'node:assert/strict';
import {completionText,verifiedIdentitySpan} from '../src/lib/completion-envelope.ts';
test('completion envelopes accept valid objects and JSON strings but reject incomplete or corrupt responses',()=>{
 const value={choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]};
 assert.equal(completionText(value),'{"ok":true}');assert.equal(completionText(JSON.stringify(value)),'{"ok":true}');
 for(const bad of [null,{},'binary\u0000',{choices:[]},{choices:[{finish_reason:'length',message:{content:'partial'}}]}])assert.throws(()=>completionText(bad));
});
test('identity claims require actual exact source spans naming the intended person or brokerage',()=>{
 const page='Listed by Kathy Oakes, Greater Impact Realty LLC.';
 assert.equal(verifiedIdentitySpan(page,'Kathy Oakes','Kathy Oakes'),true);
 assert.equal(verifiedIdentitySpan(page,'Greater Impact Realty LLC','Greater Impact Realty'),true);
 assert.equal(verifiedIdentitySpan(page,'Kathy Oakes','Jane Oakes'),false);
 assert.equal(verifiedIdentitySpan(page,'Kathy Smith','Kathy Smith'),false);
 assert.equal(verifiedIdentitySpan(page,'','Kathy Oakes'),false);
});
