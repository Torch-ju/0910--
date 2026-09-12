import { it, expect } from "vitest";
import { assertSameOrigin, safeBody } from "@/app/api/story/_io";
it("rejects cross-site writes while allowing local CLI and same-origin requests", async () => {
  expect(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/story/main", { headers: { origin: "https://unrelated.example" } }))).toThrow();
  expect(() => assertSameOrigin(new Request("http://127.0.0.1:3000/api/story/main", { headers: { origin: "http://127.0.0.1:3000" } }))).not.toThrow();
  expect(await safeBody(new Request("http://127.0.0.1:3000/api/story/main", { method: "POST", body: '{"action":"test"}' }))).toEqual({ action: "test" });
});

it("uses the incoming Host when Next rewrites its internal URL", () => {
  const request = (origin: string, extra = {}) => new Request("http://localhost:3000/api/story/framework", {
    headers: { host: "127.0.0.1:3000", origin, ...extra },
  });
  expect(() => assertSameOrigin(request("http://127.0.0.1:3000"))).not.toThrow();
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3001", "https://127.0.0.1:3000", "null", "https://unrelated.example"]) {
    expect(() => assertSameOrigin(request(origin))).toThrow();
  }
  expect(() => assertSameOrigin(request("https://unrelated.example", { "x-forwarded-host": "unrelated.example", "x-forwarded-proto": "https" }))).toThrow();
});
