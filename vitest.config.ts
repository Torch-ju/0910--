import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({ plugins: [react()], resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, test: { environment: "node", include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"], exclude: ["e2e/**"], testTimeout: 15000 } });
