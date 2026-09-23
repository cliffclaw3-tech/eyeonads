import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractTextEvidence,normalizeTextReview} from '../src/lib/text-evidence.ts';
const evidence=(identityExcerpts,extra={})=>({firmName:'Greater Impact Realty',identityExcerpts,partialSource:true,...extra});
const flag=(rule,explanation,severity='yellow')=>({rule,explanation,severity,recommendation:'Verify the evidence.'});
const review=flags=>({result:'yellow',flags,summary:'The original concern needs review.'});
test('firm name followed by phone in one captured excerpt is visible evidence, not legal clearance',()=>{
 const facts=extractTextEvidence(evidence('Andrew Marshall (443) 643-5804 Greater Impact Realty Jonesborough, (423) 973-8634'));
 assert.equal(facts.firm_name_visible,true);assert.equal(facts.firm_phone_visible,true);
 assert.equal(facts.firm_phone_evidence[0].phone,'(423) 973-8634');assert.ok(!facts.firm_phone_evidence.some(item=>item.phone.includes('443')));
 assert.equal(extractTextEvidence(evidence('GREATER IMPACT REALTY Office: 423-973-8634')).firm_phone_visible,true);
});
test('preceding agent phone, different excerpt, other firm and malformed captures do not establish firm phone',()=>{
 for(const text of ['Agent 443-643-5804 Greater Impact Realty Jonesborough','Greater Impact Realty; Other Realty 423-973-8634','Greater Impact Realty Agent Mallary 423-973-8634','Greater Impact Realty\nOther Contact 423-973-8634',['Greater Impact Realty','423-973-8634'],'Other Realty 423-973-8634','Greater Impact Realty Keller Williams 423-973-8634','Greater Impact Realty Compass 423-973-8634','NotGreater Impact Realty 423-973-8634',null,42,{},['Greater Impact Realty',null,42], 'x'.repeat(5001)]){
  assert.equal(extractTextEvidence(evidence(text)).firm_phone_visible,false,JSON.stringify(text)?.slice(0,100));
 }
 assert.equal(extractTextEvidence(evidence('Other Realty 423-973-8634')).firm_name_visible,false);
 assert.equal(extractTextEvidence(evidence('Greater Impact Realty 423-973-8634',{firmName:''})).firm_phone_visible,false);
});
test('exact Mallary audit fixture removes contradictory phone claim but retains income and rental risks',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/text-evidence-audit.json',import.meta.url),'utf8')).find(row=>row.agent==='Mallary Kelley');
 const normalized=normalizeTextReview(fixture.result,evidence(Object.values(fixture.identity)));
 assert.equal(normalized.result,'yellow');assert.equal(normalized.flags.length,2);
 assert.match(normalized.flags[0].rule,/income/);assert.match(normalized.flags[1].rule,/rental/);
 assert.match(normalized.coverage_notes.join(' '),/correctness, currency and legal compliance are unverified/);
 assert.ok(!normalized.summary.includes('does not show'));
 assert.equal(fixture.result.flags.length,3,'input evidence must not be mutated');
});
test('exact Andrew audit fixture moves pure scope gap to coverage and green means no text issue, not approval',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/text-evidence-audit.json',import.meta.url),'utf8')).find(row=>row.agent==='Andrew Marshall');
 const normalized=normalizeTextReview(fixture.result,evidence(Object.values(fixture.identity)));
 assert.equal(normalized.result,'green');assert.equal(normalized.flags.length,0);
 assert.match(normalized.summary,/not approval/);assert.match(normalized.summary,/partial/);
 assert.match(normalized.coverage_notes.join(' '),/third-party publication/);
});
test('normalizer retains correctness, substantive risks and mixed findings despite visible phone',()=>{
 const flags=[flag('Incorrect firm phone','The firm phone number is incorrect.'),flag('Incomplete context and discriminatory language','The text excludes families with children.','red'),flag('Unsupported rental promise','Claims unrestricted rentals and guaranteed income.'),flag('Firm telephone number','The excerpt does not establish whether this is the required firm telephone number.'),flag('Incomplete context and bedroom count', 'The bedroom count differs between sources.'),flag('Missing firm name and license','The firm name and license number are missing.')];
 const normalized=normalizeTextReview(review(flags),evidence('Greater Impact Realty 423-973-8634'));
 assert.equal(normalized.flags.length,flags.length);
});
test('only proven contradiction is removed; substantive red severity and no-evidence cases survive',()=>{
 const missing=flag('Missing firm telephone number','No firm telephone number is shown.'),risk=flag('Discriminatory preference','Families with children are excluded.','red');
 const normalized=normalizeTextReview(review([missing,risk]),evidence('Greater Impact Realty 423-973-8634'));
 assert.equal(normalized.result,'red');assert.deepEqual(normalized.flags,[risk]);
 assert.equal(normalizeTextReview(review([missing]),evidence('Agent 423-973-8634 Greater Impact Realty')).flags.length,1);
 assert.equal(normalizeTextReview(review([missing]),evidence('Greater Impact Realty 423-973-8634',{partialSource:false})).flags.length,1);
 const original=review([missing]);assert.equal(normalizeTextReview(original),original);
});
