"use client";
import { useEffect, useState } from "react";
import { STEP_ORDER } from "@/lib/orchestration/contracts";
import type { Run } from "@/lib/orchestration/contracts";
import { stepLabel } from "./step-labels";

export type GenerationStep = { name: string; state: "pending" | "running" | "done" | "failed" };

export function pipelineSteps(run: Run): GenerationStep[] {
  return STEP_ORDER.map(name => {
    const step = run.steps[name];
    const state: GenerationStep["state"] = !step ? "pending" : step.status === "done" ? "done" : step.status === "failed" ? "failed" : "running";
    return { name: stepLabel(name, run.pipeline), state };
  });
}

/** Waiting marker: pulsing dots, the current stage, elapsed seconds and the live step row. */
export function GenerationStatus({ label, steps, startedAt }: { label: string; steps?: GenerationStep[]; startedAt?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(timer); }; }, []);
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const seconds = now !== null && Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : null;
  return <section className="wa-live" role="status" aria-live="polite">
    <span className="wa-live__dots" aria-hidden="true"><i /><i /><i /></span>
    <b>{label}</b>
    {seconds !== null && <small>已等待 {seconds} 秒</small>}
    {steps && steps.length > 0 && <ol className="wa-live__steps">{steps.map(step => <li key={step.name} data-state={step.state}>{step.name}</li>)}</ol>}
  </section>;
}
