import { render as testingLibraryRender, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";

import zh from "@/messages/zh.json";

function ChineseProvider({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider locale="zh" messages={zh}>{children}</NextIntlClientProvider>;
}

export function render(ui: ReactElement, options: Omit<RenderOptions, "wrapper"> = {}) {
  return testingLibraryRender(ui, { ...options, wrapper: ChineseProvider });
}
