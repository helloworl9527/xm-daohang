import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

import { mergeWithChineseFallback, resolveLocale } from "@/lib/i18n/config";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get("locale")?.value);
  return {
    locale,
    messages: locale === "en" ? mergeWithChineseFallback(zh, en) : zh,
  };
});
