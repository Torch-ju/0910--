"use client";
import { useWorkbench } from "@/features/story/use-workbench";
import { StoryWorkbench } from "@/features/story/ui/StoryWorkbench";
export default function Page(){const props=useWorkbench();return <StoryWorkbench {...props}/>;}
