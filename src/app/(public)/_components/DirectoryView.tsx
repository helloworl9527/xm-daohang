"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { PublicDirectoryGroup } from "@/lib/categories/publicDirectory";
import type { SiteCard } from "@/lib/items/publicCorpus";

function stableId(group: PublicDirectoryGroup, index: number) {
  return group.id ? `category-${group.id}` : `category-unclassified-${index}`;
}

export function SiteLink({ site }: { site: SiteCard }) {
  const [failed, setFailed] = useState(false);
  const host = (() => { try { return new URL(site.url).hostname; } catch { return site.url; } })();
  const label = (host.replace(/^www\./, "").at(0) ?? "?").toUpperCase();
  return (
    <a className="directory-card" href={site.url} rel="noopener nofollow" target="_blank">
      <span className="directory-favicon" aria-hidden="true">
        {/* Same-origin dynamic favicon bytes are already bounded and cached by the route. */}
        {failed ? label : (
          // eslint-disable-next-line @next/next/no-img-element -- Next Image emits CSP-blocked inline styles.
          <img alt="" height="36" loading="lazy" onError={() => setFailed(true)} src={site.faviconPath} width="36" />
        )}
      </span>
      <span className="directory-card-copy">
        <strong>{site.title?.trim() || site.url}</strong>
        {site.summary ? <span>{site.summary}</span> : null}
        <small>{site.tags.join(" · ")}</small>
      </span>
      <ExternalLink aria-hidden="true" className="directory-external" size={18} />
    </a>
  );
}

export function DirectoryView({ groups }: { groups: PublicDirectoryGroup[] }) {
  const t = useTranslations("public.directory");
  const [current, setCurrent] = useState<string | null>(null);
  return (
    <div className="directory-view">
      <nav aria-label={t("indexLabel")} className="directory-index">
        {groups.map((group, index) => {
          const id = stableId(group, index);
          return <a aria-current={current === id ? "location" : undefined} href={`#${id}`} key={id} onClick={(event) => {
            event.preventDefault(); setCurrent(id); history.replaceState(null, "", `#${id}`);
            document.getElementById(id)?.focus();
          }}>{group.name ?? t("unclassified")}<span>{String(group.sites.length).padStart(2, "0")}</span></a>;
        })}
      </nav>
      <div className="directory-groups">
        {groups.map((group, index) => {
          const id = stableId(group, index);
          return <section aria-labelledby={id} className="directory-group" key={id}>
            <header><h2 id={id} tabIndex={-1}>{group.name ?? t("unclassified")}</h2><span>{t("siteCount", { count: String(group.sites.length).padStart(2, "0") })}</span></header>
            {group.sites.length ? <div className="directory-grid">{group.sites.map((site) => <SiteLink key={site.id} site={site} />)}</div> : <p className="directory-empty">{t("emptyGroup")}</p>}
          </section>;
        })}
      </div>
    </div>
  );
}
