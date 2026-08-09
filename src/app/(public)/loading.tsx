import { getTranslations } from "next-intl/server";
import Link from "next/link";

export default async function PublicLoading() {
  const t = await getTranslations("public");
  return (
    <div className="public-shell" aria-busy="true">
      <header className="public-header">
        <Link aria-label={t("brandLabel")} className="public-brand" href="/">
          <span aria-hidden="true">CZ</span>
          <strong translate="no">{t("brand")}</strong>
        </Link>
      </header>
      <main className="public-main" id="public-main">
        <section className="public-intro public-loading-intro" aria-hidden="true">
          <span /><span /><span />
        </section>
        <section className="public-daily-grid public-loading-grid" aria-label={t("loading")}>
          {Array.from({ length: 3 }, (_, index) => (
            <div className="public-item" key={index}><span /><span /><span /></div>
          ))}
        </section>
      </main>
      <aside aria-label={t("ask.regionLabel")} className="public-ask-dock">
        <form className="public-ask-form">
          <label>
            <span className="sr-only">{t("ask.inputLabel")}</span>
            <input autoComplete="off" disabled name="question" placeholder={t("ask.placeholder")} />
          </label>
          <button aria-label={t("loading")} disabled type="button"><span aria-hidden="true">→</span></button>
        </form>
        <div className="public-ask-meta"><span>{t("loading")}</span></div>
      </aside>
    </div>
  );
}
