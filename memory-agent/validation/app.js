const $ = (selector) => document.querySelector(selector);
let state = null;
let completed = new Set();

const narration = (quote, segmentId = "n1", sourceKind = "narration", confidence = 1) => ({
  sourceKind, segmentId, quote, confidence,
});
const empty = () => ({ mentions: [], events: [], facts: [], relationships: [], identities: [] });

const scenarios = [
  {
    key: "setup",
    title: "01 建立人物记忆",
    description: "识别林渊和苏雨，记录比赛、出生地与重要关系。",
    text: "林渊出生于北境。他在比赛中救下苏雨，两人因此成为朋友。",
    make() {
      const x = empty();
      x.mentions = [
        { ref: "lin", displayName: "林渊", evidence: narration("林渊出生于北境") },
        { ref: "su", displayName: "苏雨", evidence: narration("林渊在比赛中救下苏雨") },
      ];
      x.events = [{ eventKey: "match-rescue", summary: "林渊在比赛中救下苏雨", participantRefs: ["lin", "su"], importance: .92, evidence: narration("林渊在比赛中救下苏雨") }];
      x.facts = [
        { subjectRef: "lin", key: "出生地", value: "北境", inference: false, temporal: "static", evidence: narration("林渊出生于北境") },
        { subjectRef: "lin", key: "当前行为倾向", value: "保护他人", inference: true, temporal: "state", evidence: narration("林渊在比赛中救下苏雨", "n1", "agent_inference", .78) },
      ];
      x.relationships = [{ fromRef: "su", toRef: "lin", type: "朋友", description: "林渊在比赛中救下苏雨，两人由此建立朋友关系。", importance: .85, evidence: narration("两人因此成为朋友") }];
      return x;
    },
  },
  {
    key: "change",
    title: "02 动态状态变化",
    description: "林渊行为转变，旧状态保留并产生纠错通知。",
    text: "林渊为了夺取线索，开始威胁无辜者。",
    make() {
      const x = empty();
      x.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊开始威胁无辜者") }];
      x.events = [{ eventKey: "threaten-bystander", summary: "林渊为了线索威胁无辜者", participantRefs: ["lin"], importance: .8, evidence: narration("林渊为了夺取线索，开始威胁无辜者") }];
      x.facts = [{ subjectRef: "lin", key: "当前行为倾向", value: "为达目标开始伤害无辜者", inference: false, temporal: "state", evidence: narration("林渊为了夺取线索，开始威胁无辜者") }];
      return x;
    },
  },
  {
    key: "mask",
    title: "03 身份暂不合并",
    description: "蒙面剑客自称林渊；角色自述不足，生成待确认通知。",
    text: "蒙面剑客说：我就是林渊。但旁白没有证实。",
    make() {
      const x = empty();
      x.mentions = [
        { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("蒙面剑客出现") },
        { ref: "lin", displayName: "林渊", evidence: narration("蒙面剑客提到林渊") },
      ];
      x.identities = [{ leftRef: "masked", rightRef: "lin", relation: "same_person", evidence: narration("我就是林渊", "d1", "character_statement", .9) }];
      return x;
    },
  },
  {
    key: "reveal",
    title: "04 旁白揭示身份",
    description: "旁白确认后合并人物，同时保留蒙面剑客别名与历史。",
    text: "剑客摘下面具。旁白确认：他正是林渊。",
    make() {
      const x = empty();
      x.mentions = [
        { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("剑客摘下面具") },
        { ref: "lin", displayName: "林渊", evidence: narration("他正是林渊") },
      ];
      x.identities = [{ leftRef: "masked", rightRef: "lin", relation: "same_person", evidence: narration("他正是林渊", "n1", "explicit_identity_reveal", 1) }];
      return x;
    },
  },
  {
    key: "correction",
    title: "05 明确事实纠正",
    description: "旁白纠正出生地，旧事实不删除，并通知用户。",
    text: "此前档案有误，旁白确认林渊实际出生于南境。",
    make() {
      const x = empty();
      x.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊实际出生于南境") }];
      x.facts = [{ subjectRef: "lin", key: "出生地", value: "南境", inference: false, temporal: "static", correctionIntent: true, evidence: narration("此前档案有误，林渊实际出生于南境") }];
      return x;
    },
  },
];

function nextTurn(text) {
  const index = (state?.version ?? 0) + 1;
  return {
    requestId: `validation-request-${index}-${Date.now()}`,
    storyId: "validation-story",
    chapterNo: index,
    sceneNo: 1,
    turnId: `validation-turn-${index}`,
    previousMemoryVersion: state?.version ?? 0,
    narrative: { text },
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.style.background = error ? "#a83c35" : "#202622";
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2800);
}

function latestPortraits() {
  const map = new Map();
  for (const portrait of state.portraits || []) {
    const existing = map.get(portrait.characterId);
    if (!existing || existing.memoryVersion < portrait.memoryVersion) map.set(portrait.characterId, portrait);
  }
  return [...map.values()].filter((portrait) => {
    const character = state.characters.find((item) => item.characterId === portrait.characterId);
    return character && !["merged", "invalid"].includes(character.status);
  });
}

function render() {
  $("#version").textContent = state.version;
  const activeCharacters = state.characters.filter((item) => !["merged", "invalid"].includes(item.status));
  $("#metric-characters").textContent = activeCharacters.length;
  $("#metric-events").textContent = state.events.length;
  $("#metric-relations").textContent = state.relationships.filter((item) => item.isImportant && item.status === "active").length;
  $("#metric-notifications").textContent = state.notifications.filter((item) => item.status === "pending").length;
  $("#raw-state").textContent = JSON.stringify(state, null, 2);

  const portraits = latestPortraits();
  const portraitRoot = $("#portraits");
  portraitRoot.className = portraits.length ? "portraits" : "portraits empty";
  portraitRoot.innerHTML = portraits.length ? portraits.map((snapshot) => {
    const p = snapshot.portrait;
    const aliases = p.character.aliases.length ? p.character.aliases.map((alias) => `<span class="tag">${escapeHtml(alias)}</span>`).join("") : '<span class="tag">暂无别名</span>';
    return `<article class="portrait"><h3>${escapeHtml(p.character.displayName)}</h3><div class="id">${escapeHtml(p.character.id)} · v${snapshot.memoryVersion}</div><div class="tags">${aliases}</div><div class="fact"><b>核心画像</b>${escapeHtml(p.coreSummary)}</div><div class="id">${p.coreSummaryCharacterCount}/100 字</div><div class="fact"><b>动态轨迹</b>${escapeHtml(p.dynamicTrajectory)}</div><div class="id">${p.dynamicTrajectoryCharacterCount}/100 字</div></article>`;
  }).join("") : "运行第一轮剧情后显示画像";

  const notices = [...state.notifications].reverse();
  const conflicts = state.conflicts.filter((item) => item.status === "pending");
  const noticeRoot = $("#notifications");
  const attention = [
    ...notices.map((item) => ({ text: item.message, meta: `${item.type} · ${item.status}` })),
    ...conflicts.map((item) => ({ text: item.description, meta: `${item.type} · ${item.status}` })),
  ];
  noticeRoot.className = attention.length ? "list" : "list empty";
  noticeRoot.innerHTML = attention.length ? attention.map((item) => `<div class="list-item warn">${escapeHtml(item.text)}<small>${escapeHtml(item.meta)}</small></div>`).join("") : "暂无通知";

  const events = [...state.events].reverse();
  const eventRoot = $("#events");
  eventRoot.className = events.length ? "list" : "list empty";
  eventRoot.innerHTML = events.length ? events.map((item) => `<div class="list-item">${escapeHtml(item.summary)}<small>记忆版本 ${item.memoryVersion} · 重要度 ${item.importance}</small></div>`).join("") : "暂无事件";

  document.querySelectorAll(".scenario").forEach((button) => {
    button.classList.toggle("done", completed.has(button.dataset.key));
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

async function runScenario(scenario) {
  try {
    const body = await api("/api/process", {
      method: "POST",
      body: JSON.stringify({ turn: nextTurn(scenario.text), extraction: scenario.make() }),
    });
    state = body.state;
    completed.add(scenario.key);
    render();
    toast(`${scenario.title} 已完成，记忆版本更新到 ${state.version}`);
  } catch (error) {
    toast(error.message, true);
  }
}

function mountScenarios() {
  const root = $("#scenario-buttons");
  for (const scenario of scenarios) {
    const button = document.createElement("button");
    button.className = "scenario";
    button.dataset.key = scenario.key;
    button.innerHTML = `<strong>${scenario.title}</strong><span>${scenario.description}</span>`;
    button.addEventListener("click", () => runScenario(scenario));
    root.append(button);
  }
}

async function initialize() {
  mountScenarios();
  const health = await api("/api/health");
  $("#health").textContent = health.mode === "in-memory-validation" ? "验证服务在线" : "服务在线";
  $("#health-dot").classList.add("online");
  state = await api("/api/state");
  render();

  const custom = scenarios[0];
  $("#custom-narrative").value = custom.text;
  $("#custom-extraction").value = JSON.stringify(custom.make(), null, 2);
}

$("#reset").addEventListener("click", async () => {
  state = await api("/api/reset", { method: "POST", body: "{}" });
  completed = new Set();
  render();
  toast("人物记忆已重置");
});

$("#run-custom").addEventListener("click", async () => {
  try {
    const text = $("#custom-narrative").value.trim();
    const extraction = JSON.parse($("#custom-extraction").value);
    const body = await api("/api/process", {
      method: "POST",
      body: JSON.stringify({ turn: nextTurn(text), extraction }),
    });
    state = body.state;
    render();
    toast(`自定义轮次已完成，记忆版本更新到 ${state.version}`);
  } catch (error) {
    toast(error.message, true);
  }
});

initialize().catch((error) => {
  $("#health").textContent = "验证服务异常";
  toast(error.message, true);
});
