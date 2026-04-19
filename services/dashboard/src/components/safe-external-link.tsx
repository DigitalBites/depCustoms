import type { ReactNode } from "react";
import { getSafeExternalHref } from "@/lib/url-safety";

export function SafeExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  const safeHref = getSafeExternalHref(href);
  const label = children ?? href;

  if (!safeHref) {
    return <span className={className}>{label}</span>;
  }

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {label}
    </a>
  );
}
