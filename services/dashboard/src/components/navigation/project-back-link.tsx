"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getProjectReturnPath } from "@/lib/project-navigation";

export function ProjectBackLink({
  className = "text-xs text-muted-foreground hover:underline",
}: {
  className?: string;
}) {
  const searchParams = useSearchParams();
  const href = getProjectReturnPath(searchParams.get("from"));
  const label = href === "/dashboard" ? "← Dashboard" : "← Projects";

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
