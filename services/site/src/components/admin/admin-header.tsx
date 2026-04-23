import type { ReactNode } from "react";
import { Activity } from "lucide-react";

import { ThemeToggle } from "@/components/shared/theme-toggle";

export function AdminHeader({ actions }: { actions: ReactNode }) {
  return (
    <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
      <div className="flex min-h-16 items-center justify-between gap-4 px-5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-muted/40">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              Prism Refactory
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Admin workspace
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actions}
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
