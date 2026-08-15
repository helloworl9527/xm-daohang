"use client";

import { ExternalLink, GitFork, Globe2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { PublicDirectoryGroup } from "@/lib/categories/publicDirectory";
import type { SiteCard } from "@/lib/items/publicCorpus";

function stableId(group: PublicDirectoryGroup, index: number) {
  return group.id ? `category-${group.id}` : `category-unclassified-${index}`;
}

export interface SitePresentation {
  kind: "web" | "github";
  hostname: string;
}

export function deriveSitePresentation(url: string): SitePresentation {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { kind: "web", hostname: url || "?" };
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (hostname === "github.com" && parts.length >= 2 && parts[0] && parts[1]) {
      return { kind: "github", hostname: `${parts[0]}/${parts[1]}` };
    }
    return { kind: "web", hostname: hostname || url || "?" };
  } catch {
    return { kind: "web", hostname: url || "?" };
  }
}

export function SiteLink({ site }: { site: SiteCard }) {
  const t = useTranslations("public");
  const [failed, setFailed] = useState(false);
  const presentation = deriveSitePresentation(site.url);
  return (
    <a className={`directory-card directory-card--${presentation.kind}`} href={site.url} rel="noopener nofollow" target="_blank">
      <span className="directory-favicon" aria-hidden="true">
        {presentation.kind === "github" ? <GitFork aria-hidden="true" size={21} /> : failed ? <Globe2 aria-hidden="true" size={21} /> : (
          // eslint-disable-next-line @next/next/no-img-element -- Next Image emits CSP-blocked inline styles.
          <img alt="" height="36" loading="lazy" onError={() => setFailed(true)} src={site.faviconPath} width="36" />
        )}
      </span>
      <span className="directory-card-copy">
        <span className="directory-type">{t(`directory.${presentation.kind === "github" ? "githubType" : "webType"}`)}</span>
        <strong>{site.title?.trim() || site.url}</strong>
        {site.summary ? <span>{site.summary}</span> : null}
        <small>{presentation.hostname}</small>
        {site.tags.length ? <span className="directory-tags" aria-label={t("tagsLabel")}>{site.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}</span> : null}
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
