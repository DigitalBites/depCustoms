import { Layers } from "lucide-react";
import {
  ProjectCard,
  ProjectCardSkeleton,
} from "@/features/dashboard/components/project-card";
import type { DashboardProjectData } from "@/features/dashboard/types";

// ---------------------------------------------------------------------------
// ProjectGrid — responsive grid of project cards
// ---------------------------------------------------------------------------

export function ProjectGrid({
  cards,
  loading,
  error,
}: {
  cards: DashboardProjectData[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <section>
      <h2 className="mb-4 text-base font-semibold text-foreground">Projects</h2>

      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <ProjectCardSkeleton key={i} />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
          <Layers className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">No projects yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a project to start tracking package health.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((card) => (
            <ProjectCard key={card.project.id} data={card} />
          ))}
        </div>
      )}
    </section>
  );
}
