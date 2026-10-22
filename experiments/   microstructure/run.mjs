import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { platform, arch } from 'node:os';
import { build } from 'esbuild';
import { setup, startPractice, placePractice, practiceAccount, now, eventId, order } from '../../tests/helpers/practice.mjs';
import { bookMetrics } from './metrics.mjs';
async function load(path) {
  const b=await build({entryPoints:[new URL(path,import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
  return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const { continueMatching }=await load('../../lib/practice/service.ts');
const { readMarket }=await load('../../lib/practice/market.ts');
const out=new URL('./results/',import.meta.url);
mkdirSync(out,{recursive:true});
for(const file of ['results.json','observations.csv','report.md']) rmSync(new URL(file,out),{force:true});
const event={id:eventId,revision:1,status:'published',closesAt:new Date(now+86400000).toISOString()};
const scenarios=[];
for (const side of ['yes','no']) {
  for (const depth of [0,3,10,30]) scenarios.push({id:`depth-${side}-${depth}`,family:'depth',side,makerPrice:60,chunks:depth?[depth]:[],limit:40});
  for (const chunk of [10,5,2,1]) scenarios.push({id:`fragmentation-${side}-${chunk}`,family:'fragmentation',side,makerPrice:60,chunks:Array(10/chunk).fill(chunk),limit:40});
  for (const makerPrice of [40,50,60]) for (const limit of [35,40,50,60]) scenarios.push({id:`price-grid-${side}-${makerPrice}-${limit}`,family:'price-grid',side,makerPrice,chunks:[10],limit});
}
const rows=[];
for (const cfg of scenarios) {
  const s=setup();
  try {
    const c={userId:'c',email:'c@example.test',displayName:'C'};
    for (const actor of [s.a,s.b,c]) await startPractice(s.db,actor);
    const makerOutcome=cfg.side==='yes'?'no':'yes';
    const makerIds=[];
    for(const quantity of cfg.chunks) makerIds.push((await placePractice(s.db,s.a,order({outcome:makerOutcome,limitPriceCents:cfg.makerPrice,quantity}),now)).order.id);
    // A separate account supplies a non-crossing bid on the incoming side.
    await placePractice(s.db,s.b,order({outcome:cfg.side,limitPriceCents:30,quantity:10}),now);
    assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM practice_matches').get().n,0);
    const beforeMarket=await readMarket(s.db,event,now);
    const before=bookMetrics(beforeMarket.bids,cfg.side,cfg.limit);
    const totalDepth=cfg.chunks.reduce((a,b)=>a+b,0);
    const expected=cfg.makerPrice+cfg.limit>=100 ? Math.min(10,totalDepth) : 0;
    assert.equal(before.executableDepth,cfg.makerPrice+cfg.limit>=100?totalDepth:0);
    const submitted=await placePractice(s.db,c,order({outcome:cfg.side,limitPriceCents:cfg.limit,quantity:10}),now);
    const initialFilled=submitted.order.filled_quantity;
    const initialBook=bookMetrics((await readMarket(s.db,event,now)).bids,cfg.side,cfg.limit);
    let finalFilled=initialFilled,continuations=0;
    while(finalFilled<expected) {
      assert.ok(continuations<10,'Matching did not converge');
      const account=await continueMatching(s.db,c,{eventId});
      const next=account.orders.find(o=>o.id===submitted.order.id).filled_quantity;
      assert.ok(next>finalFilled,'Continuation made no progress');
      finalFilled=next;continuations++;
    }
    assert.equal(finalFilled,expected);
    const expectedInitial=expected ? Math.min(10,cfg.chunks.slice(0,4).reduce((a,b)=>a+b,0)) : 0;
    assert.equal(initialFilled,expectedInitial,'Initial fill differs from current four-match rule');
    const matches=s.sql.prepare('SELECT * FROM practice_matches ORDER BY rowid').all();
    assert.deepEqual(matches.map(m=>m.maker_id),makerIds.slice(0,matches.length));
    assert.equal(matches.reduce((n,m)=>n+m.quantity,0),finalFilled);
    assert.equal(continuations,Math.max(0,Math.ceil(matches.length/4)-1));
    for (const m of matches) {
      assert.equal(m.maker_price,cfg.makerPrice);
      const entries=s.sql.prepare('SELECT * FROM practice_match_entries WHERE match_id=?').all(m.id);
      assert.equal(entries.length,2);
      assert.equal(new Set(entries.map(e=>e.user_id)).size,2);
      assert.equal(entries.reduce((n,e)=>n+e.principal_units,0),m.quantity*40000);
      assert.equal(entries.reduce((n,e)=>n+e.fee_units,0),m.quantity*100);
      for(const e of entries) assert.equal(e.reserved_debit_units,e.principal_units+e.fee_units+e.released_units);
    }
    for(const actor of [s.a,s.b,c]) {
      const cash=s.sql.prepare('SELECT * FROM practice_cash WHERE user_id=?').get(actor.userId);
      const progress=s.sql.prepare('SELECT o.quantity,o.price_cents,p.* FROM practice_orders o JOIN practice_order_progress p ON p.order_id=o.id WHERE o.user_id=?').all(actor.userId);
      assert.equal(cash.reserved_units,progress.reduce((n,p)=>n+p.held_units,0));
      assert.equal(cash.spent_units,progress.reduce((n,p)=>n+p.executed_principal_units+p.charged_fee_units,0));
      assert.equal(cash.available_units+cash.reserved_units+cash.spent_units,40000000);
      for(const p of progress) {
        assert.ok(p.filled_quantity>=0 && p.filled_quantity<=p.quantity);
        assert.equal(p.held_units,(p.quantity-p.filled_quantity)*p.price_cents*401);
      }
      const account=await practiceAccount(s.db,actor,0,now);
      assert.ok(account.positionsReconciled);
      assert.equal(account.positionTotals.quantity,actor.userId==='b'?0:finalFilled);
    }
    const fillCost=s.sql.prepare('SELECT COALESCE(SUM(principal_units),0) principal,COALESCE(SUM(fee_units),0) fee FROM practice_match_entries WHERE order_id=?').get(submitted.order.id);
    assert.equal(fillCost.principal,finalFilled*(100-cfg.makerPrice)*400);
    assert.equal(fillCost.fee,finalFilled*(100-cfg.makerPrice));
    const finalMarket=await readMarket(s.db,event,now);
    assert.equal(finalMarket.volume,finalFilled);
    const finalBook=bookMetrics(finalMarket.bids,cfg.side,cfg.limit);
    assert.equal(finalBook.executableDepth,Math.max(0,before.executableDepth-finalFilled));
    const r={id:cfg.id,family:cfg.family,incomingOutcome:cfg.side,makerPriceCents:cfg.makerPrice,limitCents:cfg.limit,requestedQuantity:10,makerOrderCount:cfg.chunks.length,makerOrderQuantity:cfg.chunks[0]??0,opposingQuantity:totalDepth,...before,initialFilled,finalFilled,initialFillRate:initialFilled/10,finalFillRate:finalFilled/10,continuations,matchCount:matches.length,initialSpreadCents:initialBook.yesSpreadCents,finalSpreadCents:finalBook.yesSpreadCents,remainingQuantity:10-finalFilled,executionPriceCents:finalFilled?fillCost.principal/400/finalFilled:null,feeUnits:fillCost.fee,priceImprovementCents:finalFilled?cfg.limit-fillCost.principal/400/finalFilled:null,checksPassed:true};
    rows.push(r);
    console.log(`${r.id}: depth=${r.executableDepth}, initial=${r.initialFilled}/10, final=${r.finalFilled}/10, continuation=${r.continuations}; checks passed`);
  } finally {s.sql.close();}
}
assert.equal(rows.length,40);
let commit=process.env.GITHUB_SHA??null;
if(!commit) {try{commit=readFileSync(new URL('../../.experiment-source-sha',import.meta.url),'utf8').trim();}catch{try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{}}}
const sourceHashes={};
for(const path of ['./run.mjs','./metrics.mjs','../../lib/practice/matching.ts','../../lib/practice/service.ts']) sourceHashes[path]=createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex');
const result={generatedAt:new Date().toISOString(),commit,sourceHashes,environment:{node:process.version,sqlite:process.versions.sqlite,platform:platform(),arch:arch()},methodology:{data:'Controlled synthetic orders executed by the existing service against the in-memory test adapter',conditions:40,repetitions:1,accounts:3,requestedQuantity:10,backgroundBid:30,matchCap:4,independence:'One fresh database per condition; deterministic terms; IDs and timestamps vary',scope:'Mechanism validation, not empirical forecasting or trading-strategy profitability; no statistical significance claims',depth:'Eligible opposing quantity within incoming limit before submission; excludes own orders by using distinct accounts',spread:'YES ask (100 minus best NO bid) minus best YES bid; missing side is null; negative values retained'},rows};
writeFileSync(new URL('results.json',out),JSON.stringify(result,null,2)+'\n');
const columns=Object.keys(rows[0]);
const csv=v=>v===null?'':typeof v==='string'?'"'+v.replaceAll('"','""')+'"':String(v);
writeFileSync(new URL('observations.csv',out),columns.join(',')+'\n'+rows.map(r=>columns.map(k=>csv(r[k])).join(',')).join('\n')+'\n');
const pct=x=>(x*100).toFixed(0)+'%';
const lines=['# Order-book microstructure experiment','',`Source commit: ${commit??'unknown'}`,`Environment: ${platform()} ${arch()}, Node ${process.version}, SQLite ${process.versions.sqlite}`,'','All 40 controlled conditions passed quantity, maker-order, fee, reservation, cash-conservation and position-reconciliation checks.','', '## Depth and fill rate','', 'Incoming quantity is fixed at 10. Tables show NO incoming orders; mirrored YES cases are also checked and included in the raw data.','', '| Opposing quantity | Executable depth | Initial fill rate | Final fill rate |','|---:|---:|---:|---:|'];
for(const r of rows.filter(r=>r.family==='depth'&&r.incomingOutcome==='no'))lines.push(`| ${r.opposingQuantity} | ${r.executableDepth} | ${pct(r.initialFillRate)} | ${pct(r.finalFillRate)} |`);
lines.push('','## Fragmentation at equal depth','','All rows have ten opposing contracts at the same price.','', '| Maker orders | Quantity per maker | Initial fill rate | Final fill rate | Continuations |','|---:|---:|---:|---:|---:|');
for(const r of rows.filter(r=>r.family==='fragmentation'&&r.incomingOutcome==='no'))lines.push(`| ${r.makerOrderCount} | ${r.makerOrderQuantity} | ${pct(r.initialFillRate)} | ${pct(r.finalFillRate)} | ${r.continuations} |`);
lines.push('','## Quote and limit grid','','The background NO bid is 30 cents. Changing the YES maker bid changes both the spread and the NO execution quote; this is not an isolated causal effect of spread.','', '| YES maker bid | Before spread | NO limit | Executable depth | Final fill rate | Execution price |','|---:|---:|---:|---:|---:|---:|');
for(const r of rows.filter(r=>r.family==='price-grid'&&r.incomingOutcome==='no'))lines.push(`| ${r.makerPriceCents} | ${r.yesSpreadCents} | ${r.limitCents} | ${r.executableDepth} | ${pct(r.finalFillRate)} | ${r.executionPriceCents??'—'} |`);
lines.push('','## Interpretation','','1. Under these controlled conditions, filled quantity follows the smaller of requested quantity and price-compatible opposing depth.','2. At equal depth and price, ten one-contract orders fill four contracts on the initial call and require two continuations to complete ten. A single ten-contract order fills fully in one call.','3. Execution requires complementary limits to sum to at least 100 cents. Book depth alone does not guarantee execution at the submitted limit.','4. Missing quotes remain undefined. A crossed book can temporarily remain after the four-match limit; the raw data retains initial and final spreads.','','These are deterministic mechanism experiments on synthetic orders, not independent observations of trader behavior. Repeating identical conditions would not create new statistical evidence. No out-of-sample prediction, strategy return, sell execution, or settlement payout is claimed.','');
writeFileSync(new URL('report.md',out),lines.join('\n'));
console.log('Saved results.json, observations.csv and report.md; 40/40 conditions passed.');
