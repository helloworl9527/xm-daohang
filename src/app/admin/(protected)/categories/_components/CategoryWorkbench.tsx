"use client";

import {
  Check,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wand,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  sort: number;
  autoCount: number;
  manualCount: number;
};

type Overview = {
  categories: CategoryRow[];
  eligible: { classified: number; unclassified: number; total: number };
  manualItems: number;
  completedDocs: number;
};

type Ref = { kind: "existing"; categoryId: string } | { kind: "proposal"; proposalId: string };
type Diff =
  | { kind: "add"; proposalId: string; name: string; autoCount: number; manualCount: number }
  | { kind: "rename"; proposalId: string; sourceCategoryId: string; name: string; autoCount: number; manualCount: number }
  | { kind: "merge"; proposalId: string; sourceCategoryId: string; target: Ref; autoCount: number; manualCount: number }
  | { kind: "delete"; proposalId: string; sourceCategoryId: string; autoCount: number; manualCount: number };

type DraftDiff = Diff & { accepted: boolean; draftName?: string; destination?: string };
type Proposal = { mode: "supplement" | "full"; baseVersion: number; snapshotAt: string; diffs: Diff[] };
type Run = {
  id: string;
  status: string;
  failedCount: number;
  reclassified: number;
  movedUnclassified: number;
  manualProtected?: number;
  counts?: { added: number; renamed: number; merged: number; deleted: number; ignored: number };
};

const RUN_TRANSLATION_KEYS = {
  applying: "run.applying",
  reclassifying: "run.reclassifying",
  completed: "run.completed",
  partial: "run.partial",
  failed: "run.failed",
  superseded: "run.superseded",
} as const;

function CategoryDialog({
  children,
  labelId,
  onClose,
}: {
  children: ReactNode;
  labelId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLElement>("button")?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  return (
    <dialog
      aria-labelledby={labelId}
      className="category-modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}

function acceptedDiff(diff: DraftDiff) {
  if (diff.kind === "add") {
    return { kind: diff.kind, proposalId: diff.proposalId, name: diff.draftName?.trim() ?? diff.name };
  }
  if (diff.kind === "rename") {
    return {
      kind: diff.kind,
      proposalId: diff.proposalId,
      sourceCategoryId: diff.sourceCategoryId,
      name: diff.draftName?.trim() ?? diff.name,
    };
  }
  if (diff.kind === "merge") {
    return {
      kind: diff.kind,
      proposalId: diff.proposalId,
      sourceCategoryId: diff.sourceCategoryId,
      target: diff.target,
      autoDestination: parseDestination(diff.destination ?? destinationValue(diff.target)),
    };
  }
  return {
    kind: diff.kind,
    proposalId: diff.proposalId,
    sourceCategoryId: diff.sourceCategoryId,
    autoDestination: parseDestination(diff.destination ?? "unclassified"),
  };
}

function ignoredDiff(diff: DraftDiff): Diff {
  if (diff.kind === "add") {
    return { kind: diff.kind, proposalId: diff.proposalId, name: diff.draftName?.trim() ?? diff.name, autoCount: diff.autoCount, manualCount: diff.manualCount };
  }
  if (diff.kind === "rename") {
    return {
      kind: diff.kind,
      proposalId: diff.proposalId,
      sourceCategoryId: diff.sourceCategoryId,
      name: diff.draftName?.trim() ?? diff.name,
      autoCount: diff.autoCount,
      manualCount: diff.manualCount,
    };
  }
  if (diff.kind === "merge") {
    return {
      kind: diff.kind,
      proposalId: diff.proposalId,
      sourceCategoryId: diff.sourceCategoryId,
      target: diff.target,
      autoCount: diff.autoCount,
      manualCount: diff.manualCount,
    };
  }
  return {
    kind: diff.kind,
    proposalId: diff.proposalId,
    sourceCategoryId: diff.sourceCategoryId,
    autoCount: diff.autoCount,
    manualCount: diff.manualCount,
  };
}

function destinationValue(ref: Ref): string {
  return ref.kind === "existing" ? `existing:${ref.categoryId}` : `proposal:${ref.proposalId}`;
}

function parseDestination(value: string) {
  if (value === "unclassified") return { kind: "unclassified" as const };
  const [kind, id] = value.split(":");
  return {
    kind: "target" as const,
    target: kind === "existing"
      ? { kind: "existing" as const, categoryId: id! }
      : { kind: "proposal" as const, proposalId: id! },
  };
}

async function errorCode(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  return payload?.error?.code ?? "INTERNAL_ERROR";
}

export function CategoryWorkbench({
  csrfToken,
  initialOverview,
  initialRun = null,
}: {
  csrfToken: string;
  initialOverview: Overview;
  initialRun?: Run | null;
}) {
  const t = useTranslations("admin.categories");
  const [overview, setOverview] = useState(initialOverview);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [diffs, setDiffs] = useState<DraftDiff[]>([]);
  const [generating, setGenerating] = useState<Proposal["mode"] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reclassify, setReclassify] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<Run | null>(initialRun);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);
  const requestKey = useRef<string | null>(null);

  const writeHeaders = {
    "Content-Type": "application/json",
    "x-csrf-token": csrfToken,
  };

  const refreshOverview = async () => {
    const response = await fetch("/admin/api/categories", { cache: "no-store" });
    if (!response.ok) throw new Error("OVERVIEW");
    const payload = await response.json() as { overview: Overview };
    setOverview(payload.overview);
  };

  const generate = async (mode: Proposal["mode"]) => {
    setGenerating(mode);
    setError("");
    setNotice("");
    setRun(null);
    requestKey.current = null;
    try {
      const response = await fetch("/admin/api/categories/propose", {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) throw new Error(await errorCode(response));
      const value = await response.json() as Proposal;
      setProposal(value);
      setDiffs(value.diffs.map((diff) => ({
        ...diff,
        accepted: true,
        draftName: diff.kind === "add" || diff.kind === "rename" ? diff.name : undefined,
        destination: diff.kind === "merge" ? destinationValue(diff.target) :
          diff.kind === "delete" ? "unclassified" : undefined,
      })));
      if (value.diffs.length === 0) setNotice(t("noSuggestions"));
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "AI_UPSTREAM_FAILED"
        ? t("aiUnavailable")
        : t("proposalError"));
    } finally {
      setGenerating(null);
    }
  };

  const updateDiff = (proposalId: string, patch: Partial<DraftDiff>) => {
    setDiffs((current) => current.map((diff) => diff.proposalId === proposalId
      ? { ...diff, ...patch } as DraftDiff
      : diff));
  };

  const acceptedCount = diffs.filter((diff) => diff.accepted).length;
  const ignoredCount = diffs.length - acceptedCount;
  const manualProtected = diffs.filter((diff) => diff.accepted && (diff.kind === "merge" || diff.kind === "delete"))
    .reduce((count, diff) => count + diff.manualCount, 0);

  const apply = async () => {
    if (!proposal || acceptedCount === 0) return;
    setApplying(true);
    setError("");
    setNotice("");
    requestKey.current ??= crypto.randomUUID();
    const accepted = diffs.filter((diff) => diff.accepted).map(acceptedDiff);
    const ignored = diffs.filter((diff) => !diff.accepted).map(ignoredDiff);
    try {
      const response = await fetch("/admin/api/categories/apply", {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({
          requestKey: requestKey.current,
          mode: proposal.mode,
          baseVersion: proposal.baseVersion,
          accepted,
          ignored,
          reclassifyAuto: reclassify,
        }),
      });
      if (!response.ok) {
        const code = await errorCode(response);
        if (code === "MANUAL_CATEGORY_CONFLICT") setError(t("manualConflict"));
        else if (code === "STALE_TAXONOMY") setError(t("stale"));
        else setError(t("applyError"));
        return;
      }
      const result = await response.json() as { runId: string; status: string; counts: Run["counts"] };
      setRun({ id: result.runId, status: result.status, counts: result.counts, failedCount: 0, reclassified: 0, movedUnclassified: 0 });
      setProposal(null);
      setDiffs([]);
      setConfirming(false);
      requestKey.current = null;
      await refreshOverview();
      setNotice(t("applied"));
    } catch {
      setError(t("applyNetworkError"));
    } finally {
      setApplying(false);
    }
  };

  useEffect(function pollActiveRun() {
    if (!run || run.status !== "reclassifying") return;
    const runId = run.id;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/admin/api/categories/runs/${runId}`, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { run: Run };
        if (!cancelled) setRun((current) => ({ ...current, ...payload.run }));
      } catch {
        // Polling resumes on the next interval; the last server state remains visible.
      }
    };
    void poll();
    const interval = window.setInterval(() => { void poll(); }, 2000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [run]);

  const retryRun = async () => {
    if (!run) return;
    setError("");
    try {
      const response = await fetch(`/admin/api/categories/runs/${run.id}/retry`, {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ requestKey: crypto.randomUUID() }),
      });
      if (!response.ok) throw new Error("RETRY");
      setRun({ ...run, status: "reclassifying" });
    } catch {
      setError(t("retryError"));
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/admin/api/categories", {
        method: "POST", headers: writeHeaders, body: JSON.stringify({ name: newName }),
      });
      if (response.ok) {
        setNewName("");
        await refreshOverview();
        setNotice(t("created"));
      } else {
        setError((await errorCode(response)) === "DUPLICATE_CATEGORY" ? t("duplicate") : t("crudError"));
      }
    } catch {
      setError(t("crudError"));
    } finally {
      setCreating(false);
    }
  };

  const rename = async (category: CategoryRow) => {
    try {
      const response = await fetch(`/admin/api/categories/${category.id}`, {
        method: "PATCH", headers: writeHeaders, body: JSON.stringify({ name: renameDraft }),
      });
      if (response.ok) {
        setRenaming(null);
        await refreshOverview();
        setNotice(t("renamed"));
      } else {
        setError((await errorCode(response)) === "DUPLICATE_CATEGORY" ? t("duplicate") : t("crudError"));
      }
    } catch {
      setError(t("crudError"));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      const response = await fetch(`/admin/api/categories/${deleting.id}`, {
        method: "DELETE", headers: writeHeaders, body: "{}",
      });
      if (!response.ok) throw new Error("DELETE");
      setDeleting(null);
      await refreshOverview();
      setNotice(t("deleted"));
    } catch {
      setError(t("crudError"));
    }
  };

  const sourceName = (id: string) => overview.categories.find((category) => category.id === id)?.name ?? t("missing");
  const addOptions = diffs.filter(
    (diff): diff is Extract<DraftDiff, { kind: "add" }> => diff.kind === "add" && diff.accepted,
  );

  return (
    <div className="category-layout">
      <div className="category-main">
        <div className="category-protection" role="note">
          <ShieldCheck aria-hidden="true" size={20} />
          <div><strong>{t("protectionTitle")}</strong><p>{t("protectionBody")}</p></div>
        </div>

        <section aria-labelledby="category-ai-title" className="category-section category-ai">
          <header><p>{t("aiEyebrow")}</p><h2 id="category-ai-title">{t("aiTitle")}</h2></header>
          <div className="category-ai-actions">
            <button disabled={generating !== null || applying} onClick={() => void generate("supplement")} type="button">
              <Plus aria-hidden="true" size={18} />
              <span><strong>{t("supplement")}</strong><small>{t("supplementBody")}</small></span>
            </button>
            <button disabled={generating !== null || applying} onClick={() => void generate("full")} type="button">
              <Wand aria-hidden="true" size={18} />
              <span><strong>{t("full")}</strong><small>{t("fullBody")}</small></span>
            </button>
          </div>
          {generating ? <p aria-live="polite" className="category-status"><RefreshCw aria-hidden="true" className="spin" size={16} />{t("generating")}</p> : null}
        </section>

        {proposal ? (
          <section aria-labelledby="category-diff-title" className="category-section category-diff">
            <header className="category-section-row">
              <div><p>{proposal.mode === "supplement" ? t("supplement") : t("full")}</p><h2 id="category-diff-title">{t("preview")}</h2></div>
              <button className="category-quiet-button" onClick={() => { setProposal(null); setDiffs([]); requestKey.current = null; }} type="button">
                <X aria-hidden="true" size={17} />{t("discard")}
              </button>
            </header>
            {diffs.length === 0 ? <p className="category-empty">{t("noSuggestions")}</p> : (
              <div className="category-diff-list">
                {diffs.map((diff) => (
                  <article className={`category-diff-row category-diff-row--${diff.kind}`} key={diff.proposalId}>
                    <div className="category-diff-kind"><span>{t(`kind.${diff.kind}`)}</span><small>{diff.autoCount} {t("autoShort")} · {diff.manualCount} {t("manualShort")}</small></div>
                    <div className="category-diff-change">
                      {diff.kind === "add" || diff.kind === "rename" ? (
                        <label><span>{diff.kind === "rename" ? sourceName(diff.sourceCategoryId) : t("newCategory")}</span><input autoComplete="off" disabled={!diff.accepted} maxLength={80} name={`category-name-${diff.proposalId}`} onChange={(event) => updateDiff(diff.proposalId, { draftName: event.target.value })} value={diff.draftName ?? ""} /></label>
                      ) : (
                        <p><strong>{sourceName(diff.sourceCategoryId)}</strong><span aria-hidden="true"> → </span>{diff.kind === "merge" ? t("mergeTarget") : t("deleteTarget")}</p>
                      )}
                      {diff.kind === "merge" || diff.kind === "delete" ? (
                        <label><span>{t("autoDestination")}</span><select disabled={!diff.accepted} name={`category-destination-${diff.proposalId}`} onChange={(event) => updateDiff(diff.proposalId, { destination: event.target.value })} value={diff.destination}>
                          <option value="unclassified">{t("unclassified")}</option>
                          {overview.categories.filter((category) => category.id !== diff.sourceCategoryId).map((category) => <option key={category.id} value={`existing:${category.id}`}>{category.name}</option>)}
                          {addOptions.map((candidate) => <option key={candidate.proposalId} value={`proposal:${candidate.proposalId}`}>{candidate.draftName || candidate.name}</option>)}
                        </select></label>
                      ) : null}
                    </div>
                    <div className="category-diff-decision" role="group" aria-label={t("decision")}>
                      <button aria-pressed={diff.accepted} onClick={() => updateDiff(diff.proposalId, { accepted: true })} type="button"><Check aria-hidden="true" size={16} />{t("accept")}</button>
                      <button aria-pressed={!diff.accepted} onClick={() => updateDiff(diff.proposalId, { accepted: false })} type="button"><X aria-hidden="true" size={16} />{t("ignore")}</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <footer className="category-diff-footer">
              <span>{t("decisionSummary", { accepted: acceptedCount, ignored: ignoredCount })}</span>
              <button disabled={acceptedCount === 0 || applying} onClick={() => setConfirming(true)} type="button">{t("reviewApply", { count: acceptedCount })}</button>
            </footer>
          </section>
        ) : null}

        {run ? (
          <section aria-live="polite" className="category-section category-run">
            <header><p>{t("runEyebrow")}</p><h2>{t(RUN_TRANSLATION_KEYS[run.status as keyof typeof RUN_TRANSLATION_KEYS] ?? "run.failed")}</h2></header>
            {run.counts ? <dl className="category-run-applied"><div><dt>{t("kind.add")}</dt><dd>{run.counts.added}</dd></div><div><dt>{t("kind.rename")}</dt><dd>{run.counts.renamed}</dd></div><div><dt>{t("kind.merge")}</dt><dd>{run.counts.merged}</dd></div><div><dt>{t("kind.delete")}</dt><dd>{run.counts.deleted}</dd></div><div><dt>{t("ignore")}</dt><dd>{run.counts.ignored}</dd></div></dl> : null}
            <dl><div><dt>{t("reclassified")}</dt><dd>{run.reclassified}</dd></div><div><dt>{t("movedUnclassified")}</dt><dd>{run.movedUnclassified}</dd></div><div><dt>{t("failedCount")}</dt><dd>{run.failedCount}</dd></div></dl>
            {run.status === "partial" || run.status === "failed" ? <button onClick={() => void retryRun()} type="button"><RefreshCw aria-hidden="true" size={17} />{t("retryFailures")}</button> : null}
          </section>
        ) : null}

        <section aria-labelledby="fixed-categories-title" className="category-section category-fixed">
          <header><p>{t("fixedEyebrow")}</p><h2 id="fixed-categories-title">{t("fixedTitle")}</h2></header>
          <div className="category-create-row"><label><span>{t("newName")}</span><input autoComplete="off" maxLength={80} name="category-name" onChange={(event) => setNewName(event.target.value)} value={newName} /></label><button disabled={creating || !newName.trim()} onClick={() => void create()} type="button"><Plus aria-hidden="true" size={17} />{t("create")}</button></div>
          <ul className="category-fixed-list">
            {overview.categories.map((category) => (
              <li key={category.id}>
                {renaming === category.id ? <input autoComplete="off" autoFocus maxLength={80} name={`rename-category-${category.id}`} onChange={(event) => setRenameDraft(event.target.value)} value={renameDraft} /> : <div><strong>{category.name}</strong><small>{category.autoCount} {t("autoShort")} · {category.manualCount} {t("manualShort")}</small></div>}
                <div>
                  {renaming === category.id ? <><button aria-label={t("saveRename")} onClick={() => void rename(category)} type="button"><Check aria-hidden="true" size={17} /></button><button aria-label={t("cancelRename")} onClick={() => setRenaming(null)} type="button"><X aria-hidden="true" size={17} /></button></> : <button aria-label={t("renameLabel", { name: category.name })} onClick={() => { setRenaming(category.id); setRenameDraft(category.name); }} title={t("rename")} type="button"><Pencil aria-hidden="true" size={17} /></button>}
                  <button aria-label={t("deleteLabel", { name: category.name })} onClick={() => setDeleting(category)} title={t("delete")} type="button"><Trash2 aria-hidden="true" size={17} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div aria-live="polite" className="category-feedback">{notice ? <p>{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}</div>
      </div>

      <aside aria-labelledby="category-overview-title" className="category-overview">
        <h2 id="category-overview-title">{t("overview")}</h2>
        <dl><div><dt>{t("fixedCount")}</dt><dd>{overview.categories.length}</dd></div><div><dt>{t("classified")}</dt><dd>{overview.eligible.classified}</dd></div><div><dt>{t("unclassified")}</dt><dd>{overview.eligible.unclassified}</dd></div><div><dt>{t("manualProtected")}</dt><dd>{overview.manualItems}</dd></div><div><dt>{t("excludedDocs")}</dt><dd>{overview.completedDocs}</dd></div></dl>
      </aside>

      {confirming ? <CategoryDialog labelId="category-apply-confirm-title" onClose={() => setConfirming(false)}><div><h2 id="category-apply-confirm-title">{t("confirmTitle")}</h2><p>{t("confirmSummary", { accepted: acceptedCount, ignored: ignoredCount, manual: manualProtected })}</p><label className="category-check"><input checked={reclassify} onChange={(event) => setReclassify(event.target.checked)} type="checkbox" /><span>{t("reclassify")}</span></label><p className="category-confirm-protection"><ShieldCheck aria-hidden="true" size={18} />{t("confirmProtection")}</p><div><button disabled={applying} onClick={() => setConfirming(false)} type="button">{t("cancel")}</button><button disabled={applying} onClick={() => void apply()} type="button">{applying ? t("applying") : t("confirmApply")}</button></div></div></CategoryDialog> : null}

      {deleting ? <CategoryDialog labelId="category-delete-confirm-title" onClose={() => setDeleting(null)}><div><h2 id="category-delete-confirm-title">{t("deleteTitle")}</h2><p>{t("deleteDescription", { name: deleting.name, count: deleting.autoCount + deleting.manualCount })}</p><p>{t("deleteManual", { count: deleting.manualCount })}</p><div><button onClick={() => setDeleting(null)} type="button">{t("cancel")}</button><button className="danger" onClick={() => void remove()} type="button">{t("confirmDelete")}</button></div></div></CategoryDialog> : null}
    </div>
  );
}
