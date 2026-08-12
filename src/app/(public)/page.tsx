import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";

import { getPublicAskReadiness } from "@/lib/ratelimit/publicAsk";
import { pickDailyForNow, type DailyItem } from "@/lib/items/daily";
import { hasCompletedAskCorpus } from "@/lib/items/publicCorpus";
import { AskExperience } from "@/app/(public)/_components/AskBar";

export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  const [t, locale] = await Promise.all([getTranslations("public"), getLocale()]);
  let dailyItems: DailyItem[] = [];
  let dailyFailed = false;
  try {
    dailyItems = await pickDailyForNow();
  } catch {
    dailyFailed = true;
  }

  let askReady = false;
  let hasAskCorpus = false;
  try {
    hasAskCorpus = await hasCompletedAskCorpus();
  } catch {
    hasAskCorpus = false;
  }
  try {
    await getPublicAskReadiness();
    askReady = true;
  } catch {
    askReady = false;
  }

  const disabledReason = !hasAskCorpus
    ? t("ask.disabledEmpty")
    : !askReady
      ? t("ask.disabledUnavailable")
      : null;
  const date = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeZone: process.env.APP_TIMEZONE,
  }).format(new Date());

  return (
    <div className="public-shell">
      <a className="skip-link" href="#public-main">{t("skip")}</a>
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label={t("brandLabel")}>
          <span aria-hidden="true">CZ</span>
          <strong translate="no">{t("brand")}</strong>
        </Link>
        <Link className="public-admin-link" href="/admin">{t("owner")}</Link>
      </header>
      <main className="public-main" id="public-main">
        <section className="public-intro">
          <p>{t("eyebrow", { date })}</p>
          <h1>{t("title")}</h1>
          <p>{t("description")}</p>
        </section>

        <AskExperience disabledReason={disabledReason} />

        {dailyFailed ? (
          <section className="public-home-state" role="alert">
            <h2>{t("dailyError")}</h2>
            <Link href="/">{t("refresh")}</Link>
          </section>
        ) : dailyItems.length === 0 ? (
          <section className="public-home-state">
            <h2>{t("empty")}</h2>
            <p>{t("emptyDetail")}</p>
            <Link href="/admin">{t("ownerLogin")}</Link>
          </section>
        ) : (
          <section aria-label={t("itemsLabel")} className="public-daily-grid">
            {dailyItems.map((item) => (
              <a className="public-item" href={item.url} key={item.id} rel="noreferrer" target="_blank">
                <span className="public-item-rank">{String(item.rank).padStart(2, "0")} / 03</span>
                <h2>{item.title?.trim() || item.url}</h2>
                {item.summary ? <p>{item.summary}</p> : null}
                <div aria-label={t("tagsLabel")} className="public-item-tags">
                  {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <strong>{t("openOriginal")} <span aria-hidden="true">↗</span></strong>
              </a>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
