const chapter = {
  requestId: "validation-chapter-1",
  storyId: "validation-story",
  chapterNo: 1,
  chapterVersion: 1,
  chapterTitle: "营门破局",
  narrative: {
    segments: [
      { segmentId: "p1", kind: "narration", order: 1, text: "张休在陌生的古代营帐中醒来。远处鼓声急促，他压住慌乱，迅速判断眼前局势。" },
      { segmentId: "p2", kind: "dialogue", order: 2, speakerName: "张休", text: "“先守住营门，再查清来敌。”张休盯着摇曳的火把，低声下令。" },
      { segmentId: "p3", kind: "event", order: 3, text: "张休带人冲向营门，在风卷尘沙的暮色中与来敌形成紧张对峙。" },
      { segmentId: "p4", kind: "narration", order: 4, text: "众人第一次把目光投向他，等待下一步命令。" },
    ],
  },
};

const bible = {
  storyId: chapter.storyId,
  novelTheme: "古代乱世中的生存、谋略与成长",
  genre: "历史穿越",
  eraSetting: "中国古代军营，服饰、兵器和建筑符合时代语境",
  baseStyle: "写实国风电影概念插画，克制、有叙事张力，材质细腻",
  colorScript: "低饱和青灰与暖褐色，重要人物用暖色轮廓光强调",
  lightingRules: "自然暮光与营地火光形成冷暖层次",
  compositionRules: "16:9 横幅，主要人物置于中心 70% 安全区，保留 Web 裁切余量",
  forbiddenDrift: ["现代服饰", "科幻武器", "Q版", "明显血腥", "文字水印"],
};

let latestState = null;
let waitingCharacterId = null;

const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function compact(value) {
  return JSON.stringify(value, (key, item) => {
    if (key === "displayUrl" && typeof item === "string" && item.startsWith("data:")) {
      return "data:image/…（验证图）";
    }
    if (key === "prompt" && typeof item === "string" && item.length > 180) return `${item.slice(0, 180)}…`;
    return item;
  }, 2);
}

function setStatus(text, tone = "") {
  $("status").textContent = text;
  $("status").className = tone;
}

function renderNovel(state) {
  const current = state?.illustrations?.find((item) => item.isCurrent);
  $("novel").replaceChildren();
  for (const segment of chapter.narrative.segments) {
    const item = document.createElement("div");
    item.className = `segment ${segment.kind}`;
    item.innerHTML = `<small>${segment.kind} · ${segment.segmentId}</small><p>${segment.text}</p>`;
    $("novel").append(item);
    if (current?.scenePlan.insertAfterSegmentId === segment.segmentId) {
      const figure = document.createElement("figure");
      figure.innerHTML = `<img src="${current.asset.displayUrl}" alt="${current.scenePlan.caption}"><figcaption>叙事场景插图 v${current.version} · ${current.scenePlan.caption}</figcaption>`;
      $("novel").append(figure);
    }
  }
}

function renderCandidates(state) {
  const candidates = state?.candidates ?? [];
  const grid = $("candidate-grid");
  grid.replaceChildren();
  if (!candidates.length) {
    grid.className = "candidate-grid empty";
    grid.textContent = "尚无候选图";
    return;
  }
  grid.className = "candidate-grid";
  for (const candidate of candidates) {
    const card = document.createElement("button");
    card.className = `candidate ${candidate.status}`;
    card.disabled = candidate.status !== "pending";
    card.innerHTML = `<img src="${candidate.asset.displayUrl}" alt="候选图 ${candidate.candidateNo}"><span>方案 ${candidate.candidateNo}</span><small>${candidate.status === "approved" ? "已确认" : candidate.status === "rejected" ? "未采用" : "点击确认"}</small>`;
    card.addEventListener("click", () => approveCandidate(candidate));
    grid.append(card);
  }
}

function renderIllustrations(state) {
  const current = state?.illustrations?.find((item) => item.isCurrent);
  const panel = $("illustration");
  panel.replaceChildren();
  if (!current) {
    panel.className = "illustration empty";
    panel.textContent = "自动审核通过后，将插入正文关键段落之后";
    $("regenerate").disabled = true;
  } else {
    panel.className = "illustration";
    panel.innerHTML = `<img src="${current.asset.displayUrl}" alt="${current.scenePlan.caption}"><div><strong>第 ${current.version} 版 · ${current.scenePlan.theme}</strong><p>插入 ${current.scenePlan.insertAfterSegmentId} 后｜审核：剧情 ${current.audit.scores.narrativeMatch}，场景 ${current.audit.scores.sceneStorytelling}，人物 ${current.audit.scores.characterConsistency}，质量 ${current.audit.scores.imageQuality}</p></div>`;
    $("regenerate").disabled = false;
  }
  const history = [...(state?.illustrations ?? [])].sort((a, b) => b.version - a.version);
  const historyPanel = $("history");
  historyPanel.replaceChildren();
  if (!history.length) {
    historyPanel.className = "history empty";
    historyPanel.textContent = "暂无历史版本";
  } else {
    historyPanel.className = "history";
    for (const item of history) {
      const row = document.createElement("div");
      row.innerHTML = `<span>v${item.version}</span><strong>${item.status === "current" ? "当前版本" : "历史版本"}</strong><small>${item.regenerationReason || "首次生成"}</small>`;
      historyPanel.append(row);
    }
  }
}

function render(state) {
  latestState = state;
  renderNovel(state);
  renderCandidates(state);
  renderIllustrations(state);
}

async function setup() {
  try {
    const data = await api("/api/visual-bible", { draft: bible, lock: true });
    render(data.state);
    setStatus("画风已锁定", "ok");
    $("result").textContent = compact(data.bible);
  } catch (error) {
    setStatus("设置失败", "error");
    $("result").textContent = error.message;
  }
}

async function processChapter(input = chapter) {
  try {
    setStatus("处理中…");
    const data = await api("/api/process", { chapter: input });
    render(data.state);
    $("result").textContent = compact(data.result);
    waitingCharacterId = data.result.missingReferenceCharacterIds?.[0] || null;
    $("references").disabled = !waitingCharacterId;
    if (data.result.status === "published") setStatus("已审核并展示", "ok");
    else if (data.result.status === "waiting_reference_approval") setStatus("等待人物参考图确认", "warn");
    else if (data.result.status === "waiting_visual_bible_lock") setStatus("等待画风锁定", "warn");
    else setStatus(data.result.status, "error");
  } catch (error) {
    setStatus("处理失败", "error");
    $("result").textContent = error.message;
  }
}

async function generateReferences() {
  if (!waitingCharacterId) return;
  try {
    setStatus("生成人物候选图…");
    const data = await api("/api/references/generate", {
      storyId: chapter.storyId,
      characterId: waitingCharacterId,
      count: 4,
    });
    render(data.state);
    $("references").disabled = true;
    setStatus("请选择人物标准图", "warn");
    $("result").textContent = compact({ characterId: waitingCharacterId, candidates: data.candidates });
  } catch (error) {
    setStatus("候选图生成失败", "error");
    $("result").textContent = error.message;
  }
}

async function approveCandidate(candidate) {
  try {
    const data = await api("/api/references/approve", {
      storyId: candidate.storyId,
      characterId: candidate.characterId,
      candidateId: candidate.candidateId,
    });
    render(data.state);
    setStatus("人物标准图已确认，正在生成章节插图…", "ok");
    await processChapter(chapter);
  } catch (error) {
    setStatus("确认失败", "error");
    $("result").textContent = error.message;
  }
}

async function regenerate() {
  const reason = $("regeneration-reason").value.trim();
  if (!reason) return;
  await processChapter({
    ...chapter,
    requestId: `regenerate-${Date.now()}`,
    regenerationReason: reason,
  });
}

async function reset() {
  const data = await api("/api/reset", {});
  waitingCharacterId = null;
  render(data);
  $("references").disabled = true;
  setStatus("已重置");
  $("result").textContent = "等待操作…";
}

$("setup").addEventListener("click", setup);
$("analyze").addEventListener("click", () => processChapter(chapter));
$("references").addEventListener("click", generateReferences);
$("regenerate").addEventListener("click", regenerate);
$("reset").addEventListener("click", reset);
fetch("/api/state")
  .then((response) => response.json())
  .then((data) => render(data))
  .catch(() => render(null));
