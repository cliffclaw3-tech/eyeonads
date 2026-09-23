import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchSparkRoster} from '../src/lib/spark-roster.ts';
test('Jonesborough import excludes other offices and deliberately defers Knoxville',async()=>{
 const priorFetch=globalThis.fetch, priorEndpoint=process.env.SPARK_API_ENDPOINT,priorToken=process.env.SPARK_API_TOKEN;
 process.env.SPARK_API_ENDPOINT='https://feed.example/OData/';process.env.SPARK_API_TOKEN='synthetic';
 const offices=['Jonesborough','Kingsport','Knoxville'].map((city,i)=>({OfficeKey:String(i),OfficeName:'Greater Impact Realty '+city,OfficeCity:city,OfficeStatus:'Active',Visible:true}));
 const requested=[];
 globalThis.fetch=async u=>{u=new URL(u);if(u.pathname.endsWith('Office'))return Response.json({value:offices});const key=u.searchParams.get('$filter').match(/'([^']+)'/)[1];requested.push(key);return Response.json({value:[{MemberKey:key,OfficeKey:key,MemberFullName:'Agent '+key,MemberStatus:'Active',Visible:true}]});};
 try {const pilot=await fetchSparkRoster('Greater Impact Realty');assert.equal(pilot.total,1);assert.deepEqual(requested,['0']);assert.deepEqual(pilot.missing_offices,[]);assert.match(pilot.warning,/intentionally excluded/);const full=await fetchSparkRoster('Greater Impact Realty','current-feed');assert.equal(full.total,2);assert.ok(!requested.includes('2'));}
 finally{globalThis.fetch=priorFetch;for(const [key,value]of [['SPARK_API_ENDPOINT',priorEndpoint],['SPARK_API_TOKEN',priorToken]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
