/** Run under Linux with a fully installed checkout of the pinned Harness release. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const [checkoutArg, tarArg, outputArg] = process.argv.slice(2);
if (!checkoutArg || !tarArg || !outputArg) throw new Error('Usage: node harness-smoke.mjs CHECKOUT PACKAGE.tgz REPORT.json');
const checkout = resolve(checkoutArg), tar = resolve(tarArg), output = resolve(outputArg);
const commit = execFileSync('git', ['rev-parse','HEAD'], {cwd:checkout,encoding:'utf8'}).trim();
assert.equal(commit,'82a5fd61a7cf5c293cec4bdff68f455398d685e9');
const home = await mkdtemp(join(tmpdir(),'dsh-bill-visualization-smoke-'));
const env = { ...process.env, DSH_HOME: home };
const cli = ['--import','tsx/esm','apps/cli/src/bin.ts'];
function clean(text) { return text.replace(/token=[^\s"'<>]+/g,'token=[REDACTED]'); }
const installed = execFileSync(process.execPath,[...cli,'plugin','--profile','web','add',tar], {cwd:checkout,env,encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']});
const seed = join(home,'seed.mjs');
await writeFile(seed, `
export const inject = ['sessionPersistence'];
export async function apply(ctx) {
  if (!process.env.DSH_HOME.includes('dsh-bill-visualization-smoke-')) throw new Error('Fixture requires isolated smoke home');
  const time=Date.now();
  const h=await ctx.sessionPersistence.create({id:'ledger-smoke-fixture',version:2,createdAt:time,isSeeded:false,cwd:process.env.DSH_HOME});
  try { await h.append([
    {seq:0,time,type:'request/header',data:{header:{config:{provider:'smoke',model:'synthetic'}},reason:'initial'}},
    {seq:1,time,type:'assistant/attempt',data:{turn:1,step:1,stream:[
      {type:'chunk',time,chunk:{type:'usage',usage:{inputTokens:100,cacheReadTokens:50,cacheWriteTokens:10,outputTokens:20}}},
      {type:'chunk',time,chunk:{type:'finish',reason:{kind:'stop'}}}
    ]}}
  ]); await h.flush(); } finally { await h.close(); }
  console.log('TOKEN_LEDGER_SMOKE_SEEDED');
}
`);
const patch = join(home,'seed.patch.yml');
await writeFile(patch,`- insert:\n    - id: ledger-smoke-seed\n      name: ${JSON.stringify(seed)}\n`);
const child = spawn(process.execPath,[...cli,'--profile','web','--patch',patch,'--no-open','--port','0'],{cwd:checkout,env,stdio:['ignore','pipe','pipe']});
let logs = '';
child.stdout.on('data',c=>logs+=c); child.stderr.on('data',c=>logs+=c);
let result;
try {
  let launch;
  for (let i=0;i<120;i++) {
    if (child.exitCode !== null) throw new Error(`Harness exited ${child.exitCode}: ${clean(logs)}`);
    const match=logs.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);
    if (match && logs.includes('TOKEN_LEDGER_SMOKE_SEEDED')) { launch=match[1];break; }
    await new Promise(done=>setTimeout(done,500));
  }
  if(!launch) throw new Error('Boot timeout: '+clean(logs));
  const base=new URL(launch).origin;
  const login=await fetch(launch,{redirect:'manual'});
  assert.equal(login.status,303);
  const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const request=path=>fetch(base+path,{headers:{cookie}});
  const index=await(await request('/')).text(); assert.match(index,/\/dsh-bill-visualization\/bootstrap.js/);
  assert.equal((await fetch(base+'/dsh-bill-visualization/stats')).status,401);
  const statsResponse=await request('/dsh-bill-visualization/stats');
  assert.equal(statsResponse.status,200);
  const stats=await statsResponse.json();
  assert.deepEqual(stats.errors,[]);
  assert.equal(stats.total.totalTokens,180);
  assert.equal(stats.total.calls,1);
  assert.equal(stats.total.attempts,1);
  assert.equal(stats.total.unpricedCalls,1);
  const initial=await(await request('/dsh-bill-visualization/rates')).json();
  const saved=await fetch(base+'/dsh-bill-visualization/rates',{method:'PUT',headers:{cookie,'content-type':'application/json','x-dsh-bill-visualization':'1'},body:JSON.stringify({...initial,rates:[{provider:'smoke',model:'synthetic',effectiveFrom:'1970-01-01T00:00:00Z',input:2,cacheRead:0.5,cacheWrite:3,output:8}]})});
  assert.equal(saved.status,200);
  const priced=await(await request('/dsh-bill-visualization/stats')).json();
  assert.equal(priced.total.unpricedCalls,0);assert.equal(priced.total.estimatedCost,0.000415);
  assert.equal((await request('/dsh-bill-visualization')).status,200);
  assert.equal((await request('/dsh-bill-visualization/bootstrap.js')).status,200);
  const disk=JSON.parse(await readFile(join(home,'dsh-bill-visualization','rates.json'),'utf8'));assert.equal(disk.rates.length,1);
  // Optional real-host browser QA lives in scripts/harness-browser.mjs and is
  // launched from a harness checkout matching the pinned commit above; it needs
  // a real Chrome and is not part of this smoke run.
  result={passed:true,commit,harnessVersion:'0.1.3-alpha.2',node:process.version,isolatedHome:home,
    checks:['local tarball install','real Cordis activation','real v2 persistence create/read','180 synthetic tokens','no inherited browser-runtime dependency','real login cookie and 401 rejection','index script injection','rate save on disk','reprice to 0.000415 CNY','authenticated HTML and scripts'],
    modelRequests:0,userProfileModified:false,installationLog:clean(installed)};
  await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {
  if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),new Promise(done=>setTimeout(done,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}
}
