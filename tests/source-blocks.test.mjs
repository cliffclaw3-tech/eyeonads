import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {verifiedIdentitySpan} from '../src/lib/completion-envelope.ts';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-blocks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({verifiedIdentitySpan})});
const {sourceBlocks,selectSourceBlocks}=exports;
const page='For sale: a spacious home with a covered porch and mountain views. '+('Sunny rooms and a large garden. '.repeat(12))+' Listed by Kathy Oakes. Greater Impact Realty Jonesborough. Firm phone 423-555-0100.';
const blocks=sourceBlocks(page),agentId=blocks.find(b=>b.text.includes('Kathy Oakes')).id,firmId=blocks.find(b=>b.text.includes('Greater Impact Realty')).id;
const selection={contains_promotion:true,promotion_ids:[0],disclosure_ids:[firmId],identity_confirmed:true,agent_block_id:agentId,brokerage_block_id:firmId,state:'TN',context:'Partial text sample; images not assessed.'};
test('numbered selections copy original page text, preserving provenance and bounded size',()=>{
 for(const block of blocks){assert.ok(page.includes(block.text));assert.ok(block.text.split(/\s+/).length<=35);}
 const result=selectSourceBlocks(blocks,selection,'Kathy Oakes','Greater Impact Realty');assert.equal(result.matched,true);assert.match(result.text,/covered porch/);assert.ok(result.text.split(/\s+/).length<=150);for(const block of result.selected)assert.ok(page.includes(block.text));
});
test('invented IDs, duplicate selections, absent promotions and wrong identities are not verified',()=>{
 for(const promotion_ids of [[],[-1],[blocks.length],[0,0],['0']])assert.throws(()=>selectSourceBlocks(blocks,{...selection,promotion_ids},'Kathy Oakes','Greater Impact Realty'));
 assert.throws(()=>selectSourceBlocks(blocks,{...selection,contains_promotion:false},'Kathy Oakes','Greater Impact Realty'));
 assert.equal(selectSourceBlocks(blocks,selection,'Unrelated Agent','Greater Impact Realty').matched,false);
});
