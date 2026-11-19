import { Fragment } from "react";
import copy from "@/content/copy.json";

export const C = copy;

/** Fill {placeholders} in a copy string. */
export function fill(s: string, vars: Record<string, string | number> = {}) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Like fill(), but renders **bold** segments. */
export function Rich({ s, vars }: { s: string; vars?: Record<string, string | number> }) {
  const parts = fill(s, vars).split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <b key={i} className="text-ink">{p}</b> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
