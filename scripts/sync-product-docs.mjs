import { copyFile, access } from 'node:fs/promises';
for (const name of ['PRD.md','MAIN_AGENT_RULES.md']) {
  try { await access('../'+name); } catch { continue; }
  await copyFile(name,'../'+name);
}
console.log('Existing workspace document copies synchronized.');
