import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Miniflare } from 'miniflare';
// Run the actual request builder in workerd, not Node's more permissive fetch.
const source=ts.transpileModule(readFileSync(new URL('../lib/auth/token-request.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
test('Workers token exchange accepts options and never forwards credentials on redirect',async()=>{
 const received=[];
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',script:source+`
 export default {async fetch(){
   const response=await fetch('https://oauth2.googleapis.com/token',googleTokenRequest({clientId:'test-client',clientSecret:'synthetic-secret',code:'synthetic-code',verifier:'synthetic-verifier',redirectUri:'https://event.example/api/auth/google/callback'}));
   return Response.json({status:response.status,ok:response.ok});
 }}`,outboundService:async request=>{
  received.push({url:request.url,method:request.method,body:await request.text()});
  return new Response(null,{status:302,headers:{Location:'https://other.example/should-never-receive-secrets'}});
 }});
 try {
   const response=await mf.dispatchFetch('http://test/');
   assert.deepEqual(await response.json(),{status:302,ok:false});
   assert.equal(received.length,1);assert.equal(received[0].url,'https://oauth2.googleapis.com/token');assert.equal(received[0].method,'POST');
   const body=new URLSearchParams(received[0].body);assert.equal(body.get('code_verifier'),'synthetic-verifier');assert.equal(body.get('grant_type'),'authorization_code');
 }finally{await mf.dispose();}
});
