import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {verifiedIdentitySpan} from '../src/lib/completion-envelope.ts';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/source-ad-extraction.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:()=>({verifiedIdentitySpan})});
const {validateAdExtraction}=exports;
const promotion='Build your dream home on this wooded lot with beautiful mountain views.';
const page=`${promotion} Listed by Kathy Oakes at Greater Impact Realty. Office 555-0100.`;
const extraction={identity_confirmed:true,agent_evidence:'Kathy Oakes',brokerage_evidence:'Greater Impact Realty',state:'TN',promotional_excerpt:promotion,excerpts:['Office 555-0100.'],context:'Syndicated listing; image and layout not reviewed.'};
test('actual promotional text must be verbatim and linked to the intended agent',()=>{
 const result=validateAdExtraction(page,extraction,'Kathy Oakes','Greater Impact Realty');
 assert.equal(result.matched,true);assert.ok(result.text.includes(promotion));
 assert.equal(validateAdExtraction(page,extraction,'Jane Oakes','Greater Impact Realty').matched,false);
});
test('contact-only and invented extracts cannot count as assessed advertising',()=>{
 for(const promotional_excerpt of ['', 'Listed by Kathy Oakes at Greater Impact Realty.', 'A completely invented luxury property with no original text.'])assert.throws(()=>validateAdExtraction(page,{...extraction,promotional_excerpt},'Kathy Oakes','Greater Impact Realty'));
 assert.throws(()=>validateAdExtraction(page,{...extraction,excerpts:['Invented phone number']},'Kathy Oakes','Greater Impact Realty'));
});
