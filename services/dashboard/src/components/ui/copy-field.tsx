"use client";

import { useState } from "react";

export function CopyField({
  label,
  value,
  sensitive,
  separator = "=",
  labelWidthClass = "w-52",
}: {
  label: string;
  value: string;
  sensitive?: boolean;
  separator?: "=" | ":";
  labelWidthClass?: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className={`${labelWidthClass} shrink-0 text-xs font-mono text-amber-700 dark:text-amber-400`}
      >
        {label}
        {separator}
      </span>
      <code
        className={`flex-1 rounded bg-amber-100 px-2 py-1 text-xs font-mono text-foreground dark:bg-amber-900/40 ${
          sensitive ? "select-all" : ""
        } truncate`}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
