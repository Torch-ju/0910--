// Synthetic model only. Never uses credentials or calls an external service.
import { createServer } from 'node:http';
let failNext = '', calls = 0, delay = 0;
createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (req.url === '/control') { const control = JSON.parse(raw); failNext = control.fail ?? ''; delay = control.delay ?? 0; res.end('{}'); return; }
  if (req.url === '/metrics') { res.end(JSON.stringify({ calls })); return; }
  const body = JSON.parse(raw), system = body.messages[0].content; calls++;
  const step = system.startsWith('你是角色演绎') ? 'roles' : system.startsWith('你是世界旁白') ? 'narrator' : system.startsWith('你是小说转写') ? 'transcription' : system.startsWith('你是摘要') ? 'summary' : 'memory';
  if (failNext === step) { failNext = ''; res.writeHead(503); res.end('{}'); return; }
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const outputs = {
    roles: { content: '沈砚抬头望向门口，没有作声。' },
    narrator: { current_time: '二更', current_location: '客栈', background: '灯火映着雨声。', visible_events: [] },
    transcription: { content: '雨敲着窗。沈砚抬头望向门口，没有作声。林青站在门边，柜台后仍留着一盏灯。', current_time: '二更', current_location: '客栈', new_facts: [], timeline_updates: [], foreshadowing: ['柜台后的灯'], chapter_end_hook: '灯影微动。' },
    summary: { summary: '两人在客栈相遇，旧信尚未拆开。', unresolved_threads: ['旧信的内容'] },
    memory: { mentions: [], events: [], facts: [], relationships: [], identities: [] },
  };
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(outputs[step]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }));
}).listen(Number(process.env.TEST_MODEL_PORT ?? 4011), '127.0.0.1', () => console.log('Synthetic model ready on localhost'));
