"use client";

import type { WorkbenchProps } from "@/lib/story/contracts";
import { StoryWorkbench as InnerWorkbench } from "./StoryWorkbenchShell";
import { WorkbenchUiProvider } from "./WorkbenchUiContext";

export function StoryWorkbench(props: WorkbenchProps) {
  return <WorkbenchUiProvider value={props}><InnerWorkbench {...props} /></WorkbenchUiProvider>;
}
