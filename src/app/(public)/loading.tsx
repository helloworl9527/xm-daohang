import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function PublicLoading() {
  const t = await getTranslations("public");
  return <div aria-busy="true" className="public-shell"><header className="public-header"><Link aria-label={t("brandLabel")} className="public-brand" href="/"><span aria-hidden="true">CZ</span><strong>{t("brand")}</strong></Link></header><main className="public-main"><div className="directory-title-row"><h1>{t("directory.title")}</h1><div className="keyword-placeholder" /></div><section aria-label={t("loading")} className="directory-grid directory-skeleton">{Array.from({ length: 3 }, (_, index) => <div key={index}><span /><span /><span /></div>)}</section></main><aside aria-label={t("ask.regionLabel")} className="public-ask-dock"><form className="public-ask-form"><label><span className="sr-only">{t("ask.inputLabel")}</span><input disabled placeholder={t("ask.placeholder")} /></label><button aria-label={t("ask.submit")} disabled type="button"><ArrowRight aria-hidden="true" size={18} /></button></form></aside></div>;
}
