import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "留白 · 写作陪伴", description: "从一个念头，慢慢写成你的故事。" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
