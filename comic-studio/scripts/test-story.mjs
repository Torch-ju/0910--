import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir=await mkdtemp(join(tmpdir(),'manxiang-tests-'));
try{for(const suite of ['story','generation','story-ai']){const out=join(dir,suite+'.mjs');await build({entryPoints:[`tests/${suite}.test.ts`],bundle:true,platform:'node',format:'esm',outfile:out});const result=spawnSync(process.execPath,['--test',out],{stdio:'inherit'});if(result.status)process.exitCode=result.status;}}finally{await rm(dir,{recursive:true,force:true});}
