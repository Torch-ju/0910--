import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const directory = await mkdtemp(join(tmpdir(),'shuzhongren-e2e-'));
const port=Number(process.env.E2E_PORT ?? 3112), modelPort=Number(process.env.E2E_MODEL_PORT ?? 4013);
const fixturePath=join(directory,'fixture.json');
const npm=process.platform==='win32'?'npm.cmd':'npm';
const run=(args,env={})=> {const result=spawnSync(npm,args,{stdio:'inherit',env:{...process.env,...env}});if(result.status!==0)throw Error(args.join(' ')+' failed');};
run(['exec','vitest','run','tests/export-browser-fixture.test.ts'],{BROWSER_FIXTURE_PATH:fixturePath});
if(process.env.E2E_SKIP_BUILD!=='1')run(['run','build']);
const model=spawn(process.execPath,['scripts/testing/model-server.mjs'],{stdio:'inherit',env:{...process.env,TEST_MODEL_PORT:String(modelPort)}});
const server=spawn(process.execPath,['scripts/next.mjs','start','--hostname','127.0.0.1','--port',String(port)],{stdio:'inherit',env:{...process.env,STORY_DATA_DIR:join(directory,'stories'),MODEL_LEDGER_PATH:join(directory,'ledger.json'),LLM_BASE_URL:`http://127.0.0.1:${modelPort}`,LLM_MODEL:'synthetic-text',LLM_API_KEY:'synthetic-only'}});
const launcher=process.env.TABBIT_CLI ?? (process.platform==='win32'?join(process.env.LOCALAPPDATA,'Tabbit','LocalAgent','bin','tabbit-cli.exe'):join(homedir(),'.local','bin','tabbit-cli'));
const task='writing-acceptance';
let usedBrowser=false;
try {
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}`)).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,200));}
  if(!ready)throw Error('Local application did not start');
  const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
  const program=`const testFixture=${JSON.stringify(fixture)}; const testBase=${JSON.stringify(`http://127.0.0.1:${port}`)}; const testModel=${JSON.stringify(`http://127.0.0.1:${modelPort}`)};\n`+await readFile('scripts/testing/writing.playwright','utf8');
  usedBrowser=true;
  const result=spawnSync(launcher,['nodejs','--task',task,'--request-id','flow-'+randomUUID()],{input:program,encoding:'utf8',timeout:90000});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  if(result.status!==0)throw Error('Browser flow did not pass; inspect the receipt before retrying.');
  console.log('Evidence data retained at '+directory);
} finally {
  server.kill('SIGTERM');model.kill('SIGTERM');
  if(usedBrowser)spawnSync(launcher,['finish','--task',task],{stdio:'inherit'});
}
