import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { LocaleSwitcher } from "@/lib/i18n/LocaleSwitcher";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: t("title"), description: t("description") };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await headers();
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LocaleSwitcher />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
