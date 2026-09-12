import nextEnv from '@next/env';
import { spawnSync } from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd());
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/real-recovery.test.ts'],{stdio:'inherit',env:{...process.env,RUN_REAL_RECOVERY:'1'}});
process.exitCode=result.status??1;
