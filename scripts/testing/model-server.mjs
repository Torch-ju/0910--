// Synthetic model only. Never uses credentials or calls an external service.
import { createServer } from 'node:http';
let failNext = '', failCount = 0, calls = 0, delay = 0, dialogueMode = false;
createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (req.url === '/control') { const control = JSON.parse(raw); failNext = control.fail ?? ''; failCount = control.failCount ?? 1; delay = control.delay ?? 0; dialogueMode = control.dialogue ?? dialogueMode; res.end('{}'); return; }
  if (req.url === '/metrics') { res.end(JSON.stringify({ calls })); return; }
  const body = JSON.parse(raw), system = body.messages[0].content; calls++;
  const step = system.startsWith('你是小说的NPC对话Agent') ? 'npc' : system.startsWith('你是小说人物演绎') ? 'roles' : system.startsWith('你是人物与故事线统筹') ? 'narrator' : system.startsWith('你是小说正文创作') ? 'transcription' : system.startsWith('你是摘要') ? 'summary' : 'memory';
  if (failNext === step && failCount > 0) { if(--failCount === 0) failNext = ''; res.writeHead(503); res.end('{}'); return; }
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  const outputs = {
    npc: {utterance:'信还没打开，你还想问些什么？',finished:false},
    roles: { content: '沈砚抬头望向门口，没有作声。' },
    narrator: { current_time: '二更', current_location: '客栈', background: '灯火映着雨声。', visible_events: [] },
    transcription: { ...(system.includes('这是主角参与的互动小说') ? {dialogue:null}:{}), content: '雨敲着窗。沈砚抬头望向门口，没有作声。林青站在门边，柜台后仍留着一盏灯。', current_time: '二更', current_location: '客栈', new_facts: [], timeline_updates: [], foreshadowing: ['柜台后的灯'], chapter_end_hook: '灯影微动。' },
    summary: { summary: '两人在客栈相遇，旧信尚未拆开。', unresolved_threads: ['旧信的内容'] },
    memory: { mentions: [], events: [], facts: [], relationships: [], identities: [] },
  };
  if (dialogueMode && step === 'transcription') {
    const input=JSON.parse(body.messages[1].content);
    const reply=input.npc_response?.player_response;
    const utterance=reply ? '你想先查信封，还是去问掌柜？' : '你愿意和我一起查看这封信吗？';
    outputs.transcription.content=(reply ? '林青回答：“'+reply+'”沈砚将信放在桌上。' : '雨声中，沈砚取出一封信。')+'沈砚问：“'+utterance+'”';
    outputs.transcription.dialogue={speaker_id:'npc_shen',speaker_name:'沈砚',utterance};
  }
  if (body.stream) {
    res.setHeader('content-type', 'text/event-stream');
    const content = JSON.stringify(outputs[step]);
    for (let at = 0; at < content.length; at += 16) {
      res.write('data: ' + JSON.stringify({choices:[{index:0,delta:{content:content.slice(at,at+16)},finish_reason:null}]}) + '\n\n');
      await new Promise(resolve => setTimeout(resolve, 180));
    }
    res.end('data: ' + JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}) + '\n\ndata: [DONE]\n\n');
    return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(outputs[step]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }));
}).listen(Number(process.env.TEST_MODEL_PORT ?? 4011), '127.0.0.1', () => console.log('Synthetic model ready on localhost'));
