import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"书中人 · 与 AI 共写一个世界",description:"从故事想法出发，共同构建世界、人物和初始时间线。"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
