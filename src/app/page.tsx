"use client";
import { useWorkbench } from "@/features/story/use-workbench";
import { WritingApp } from "@/features/writing/WritingApp";
export default function Page() { return <WritingApp {...useWorkbench()} />; }
