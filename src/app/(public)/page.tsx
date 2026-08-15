import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";

import { DirectoryData } from "@/app/(public)/_components/DirectoryData";
import { DirectoryShell } from "@/app/(public)/_components/DirectoryShell";
import { hasCompletedAskCorpus } from "@/lib/items/publicCorpus";
import { getPublicAskReadiness } from "@/lib/ratelimit/publicAsk";

export const dynamic = "force-dynamic";

export default async function PublicHomePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const t = await getTranslations("public");
  let hasAskCorpus = false; let askReady = false;
  try { hasAskCorpus = await hasCompletedAskCorpus(); } catch { hasAskCorpus = false; }
  try { await getPublicAskReadiness(); askReady = true; } catch { askReady = false; }
  const disabledReason = !hasAskCorpus ? t("ask.disabledEmpty") : !askReady ? t("ask.disabledUnavailable") : null;
  const hasCommittedQuery = Boolean((await searchParams).q);
  return <div className="public-shell">
    <a className="skip-link" href="#public-main">{t("skip")}</a>
    <header className="public-header"><Link aria-label={t("brandLabel")} className="public-brand" href="/"><span aria-hidden="true">CZ</span><strong translate="no">{t("brand")}</strong></Link><Link className="public-admin-link" href="/admin">{t("owner")}</Link></header>
    <main className="public-main" id="public-main">
      <DirectoryShell disabledReason={disabledReason}>{hasCommittedQuery ? null : <Suspense fallback={<section aria-busy="true" className="directory-grid directory-skeleton">{[0,1,2].map((i) => <div key={i}><span /><span /><span /></div>)}</section>}><DirectoryData /></Suspense>}</DirectoryShell>
    </main>
  </div>;
}
