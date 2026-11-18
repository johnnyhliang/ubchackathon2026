"use client";
import { type Action, countdown, fmtUsd, short } from "@/lib/useVaultState";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-card p-5 ${className}`}>{children}</div>;
}

export function TxLink({ hash, explorer, label = "view tx" }: { hash?: string; explorer: string; label?: string }) {
  if (!hash) return null;
  if (!explorer) return <span className="font-mono text-xs text-muted">{short(hash)}</span>;
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-muted underline">
      {label}
    </a>
  );
}

const statusStyle: Record<Action["status"], string> = {
  Pending: "bg-held/15 text-held",
  Approved: "bg-safe/15 text-safe",
  Executed: "bg-safe/15 text-safe",
  Cancelled: "bg-stop/15 text-stop",
};
const statusLabel: Record<Action["status"], string> = {
  Pending: "Held",
  Approved: "Approved",
  Executed: "Sent",
  Cancelled: "Stopped, money kept",
};

export function StatusPill({ status }: { status: Action["status"] }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle[status]}`}>{statusLabel[status]}</span>;
}

export function ActionRow({ a, now, explorer }: { a: Action; now: number; explorer: string }) {
  const title =
    a.kind === "Transfer"
      ? `${fmtUsd(a.amountUsd)} to ${short(a.target)}`
      : a.kind === "AddTrusted"
        ? `Add ${short(a.target)} as trusted`
        : a.kind === "RaiseLimit"
          ? `Raise daily limit to ${fmtUsd(a.amountUsd)}`
          : `Change guardian to ${short(a.target)}`;
  return (
    <li className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="text-xs text-muted">
          {a.status === "Pending" ? `releases in ${countdown(a.readyAt, now)} unless stopped` : null}{" "}
          <TxLink hash={a.executedTx ?? a.cancelledTx ?? a.txHash} explorer={explorer} />
        </div>
      </div>
      <StatusPill status={a.status} />
    </li>
  );
}
