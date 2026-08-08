import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "收藏系统",
  description: "个人收藏整理与语义检索系统",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await headers();
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
