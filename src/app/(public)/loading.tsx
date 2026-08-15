import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function PublicLoading() {
  const t = await getTranslations("public");
  return <div aria-busy="true" className="public-shell"><header className="public-header"><Link aria-label={t("brandLabel")} className="public-brand" href="/"><span aria-hidden="true">CZ</span><strong translate="no">{t("brand")}</strong></Link><Link className="public-admin-link" href="/admin">{t("owner")}</Link></header><main className="public-main"><section aria-labelledby="public-loading-title" className="public-discovery-workspace"><div className="public-discovery-heading"><p>{t("directory.eyebrow")}</p><h1 id="public-loading-title">{t("directory.workspaceTitle")}</h1><p>{t("directory.workspaceCopy")}</p></div><div className="public-discovery-mode"><span /><span /></div><div className="keyword-placeholder" /></section><section aria-label={t("loading")} className="directory-grid directory-skeleton">{Array.from({ length: 3 }, (_, index) => <div key={index}><span /><span /><span /></div>)}</section></main></div>;
}
