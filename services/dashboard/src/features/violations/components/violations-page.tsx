"use client";

import { PageHeader } from "@/components/layout/page-header";
import { ViolationsPanel } from "@/features/violations/components/violations-panel";

export function ViolationsPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Violations"
        description="Tenant-wide policy violations across your projects."
      />
      <ViolationsPanel emptyMessage="No violations recorded yet." />
    </div>
  );
}
