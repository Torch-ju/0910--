import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { JsonNarrativeMemoryExtractor } from "../adapters/json-narrative-memory-extractor.js";
import { PlaceholderPortraitAdapter } from "../adapters/placeholder-portrait-adapter.js";
import { CharacterMemoryAgent, MemoryVersionConflictError } from "../application/memory-agent.js";
import { extractionResultSchema, processTurnInputSchema } from "../contracts.js";
import type { ExtractionResult, ProcessTurnInput } from "../domain.js";
import { InMemoryMemoryRepository } from "../infrastructure/in-memory-repository.js";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const staticRoot = fileURLToPath(new URL("../../validation/", import.meta.url));

let repository = new InMemoryMemoryRepository();

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
    if (size > 2_000_000) throw new Error("Request body exceeds 2 MB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function publicState() {
  const snapshot = repository.snapshot();
  return {
    version: snapshot.processedTurns.at(-1)?.memoryVersion ?? 0,
    characters: snapshot.characters,
    aliases: snapshot.aliases,
    events: snapshot.events,
    facts: snapshot.facts,
    relationships: snapshot.relationships,
    conflicts: snapshot.conflicts,
    corrections: snapshot.corrections,
    notifications: snapshot.notifications,
    portraits: snapshot.portraits,
    identityChanges: snapshot.identityChanges,
    processedTurns: snapshot.processedTurns.map((turn) => ({
      turnId: turn.turnId,
      requestId: turn.requestId,
      memoryVersion: turn.memoryVersion,
    })),
  };
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
      json(response, 200, { status: "ok", mode: "in-memory-validation", version: publicState().version });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      json(response, 200, publicState());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      repository = new InMemoryMemoryRepository();
      json(response, 200, publicState());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/process") {
      const payload = (await readJson(request)) as {
        turn?: ProcessTurnInput;
        extraction?: ExtractionResult;
      };
      const turn = processTurnInputSchema.parse(payload.turn) as ProcessTurnInput;
      const extraction = extractionResultSchema.parse(payload.extraction) as ExtractionResult;
      const agent = new CharacterMemoryAgent(
        repository,
        new JsonNarrativeMemoryExtractor(() => extraction),
        new PlaceholderPortraitAdapter(),
      );
      const result = await agent.processTurn(turn);
      json(response, 200, { result, state: publicState() });
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    const status = error instanceof MemoryVersionConflictError ? 409 : 400;
    json(response, status, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`Character memory validation console: http://${host}:${port}\n`);
});
