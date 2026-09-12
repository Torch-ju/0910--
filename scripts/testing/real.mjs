import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/real-model.test.ts'],{stdio:'inherit',env:{...process.env,RUN_REAL_MODEL:'1'}});
process.exitCode=result.status??1;
