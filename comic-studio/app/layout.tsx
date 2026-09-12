import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "漫想 · 江湖写作陪伴",
  description: "与主角商量命运，把确认的重大事件写成江湖小说，保存章节、人物与伏笔。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
