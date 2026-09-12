"use client";

import { createContext, useContext } from "react";
import type { WorkbenchProps } from "@/lib/story/contracts";

const WorkbenchUiContext = createContext<WorkbenchProps | null>(null);
export const WorkbenchUiProvider = WorkbenchUiContext.Provider;
export function useWorkbenchUi() {
  const value = useContext(WorkbenchUiContext);
  if (!value) throw new Error("Story workbench context is unavailable.");
  return value;
}
