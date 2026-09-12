import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { MockSeedreamImageGenerator } from "../adapters/mock-image-generator.js";
import { RuleBasedNovelChapterAnalyzer } from "../adapters/rule-based-novel-analyzer.js";
import { ScriptedIllustrationReviewer } from "../adapters/scripted-reviewer.js";
import { ChapterIllustrationAgent } from "../application/illustration-agent.js";
import { CharacterReferenceService } from "../application/reference-service.js";
import { StoryVisualSetupService } from "../application/visual-setup-service.js";
import type {
  GenerateChapterIllustrationInput,
  VisualBibleDraftInput,
} from "../domain.js";
import { InMemoryAssetStorage } from "../infrastructure/in-memory-asset-storage.js";
import { InMemoryIllustrationRepository } from "../infrastructure/in-memory-repository.js";

const port = Number(process.env.PORT ?? 4183);
const host = process.env.HOST ?? "127.0.0.1";
const staticRoot = fileURLToPath(new URL("../../validation/", import.meta.url));

let repository = new InMemoryIllustrationRepository();
let storage = new InMemoryAssetStorage();

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 5_000_000) throw new Error("请求体超过 5 MB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function state() {
  return repository.snapshot();
}

function agent(failFirst = 0) {
  return new ChapterIllustrationAgent(
    repository,
    new RuleBasedNovelChapterAnalyzer(),
    new MockSeedreamImageGenerator(failFirst),
    storage,
    new ScriptedIllustrationReviewer(),
  );
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const files: Record<string, { file: string; contentType: string }> = {
    "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
    "/app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
    "/styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
  };
  const target = files[pathname];
  if (!target) {
    response.writeHead(404).end("Not found");
    return;
  }
  const body = await readFile(`${staticRoot}${target.file}`);
  response.writeHead(200, { "content-type": target.contentType, "cache-control": "no-store" });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { status: "ok", mode: "in-memory-mock", model: "doubao-seedream-4.5" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, state());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      repository = new InMemoryIllustrationRepository();
      storage = new InMemoryAssetStorage();
      json(response, 200, state());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/visual-bible") {
      const body = await readJson(request) as { draft: VisualBibleDraftInput; lock?: boolean };
      const setup = new StoryVisualSetupService(repository);
      let bible = await setup.saveDraft(body.draft);
      if (body.lock) bible = await setup.lock(body.draft.storyId);
      json(response, 200, { bible, state: state() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/process") {
      const body = await readJson(request) as {
        chapter: GenerateChapterIllustrationInput;
        simulateFailures?: number;
      };
      const result = await agent(body.simulateFailures ?? 0).processChapter(body.chapter);
      json(response, 200, { result, state: state() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/references/generate") {
      const body = await readJson(request) as { storyId: string; characterId: string; count?: number };
      const service = new CharacterReferenceService(
        repository,
        new MockSeedreamImageGenerator(),
        storage,
      );
      const candidates = await service.generateCandidates(body.storyId, body.characterId, body.count ?? 4);
      json(response, 200, { candidates, state: state() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/references/approve") {
      const body = await readJson(request) as { storyId: string; characterId: string; candidateId: string };
      const service = new CharacterReferenceService(
        repository,
        new MockSeedreamImageGenerator(),
        storage,
      );
      const profile = await service.approveCandidate(body.storyId, body.characterId, body.candidateId);
      json(response, 200, { profile, state: state() });
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Novel illustration validation console: http://${host}:${port}\n`);
});
