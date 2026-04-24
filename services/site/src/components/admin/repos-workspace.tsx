import { Boxes, CheckCircle2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TargetAppRecord, TargetEnvironmentRecord } from "@/lib/admin";

export function ReposWorkspace({
  targetApps,
  targetEnvironments,
}: {
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
  activeCount: number;
  closedCount: number;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="rounded-none border-x-0 border-y-0 border-border/60 bg-background/95 shadow-none">
        <CardHeader>
          <CardTitle>Target Inventory</CardTitle>
          <CardDescription>
            Repository targets available to the board.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {targetApps.map((targetApp) => {
            const environments = targetEnvironments.filter(
              (environment) => environment.targetAppId === targetApp.id,
            );

            return (
              <div
                key={targetApp.id}
                className="space-y-3 rounded-2xl border border-border/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{targetApp.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {targetApp.slug}
                    </p>
                  </div>
                  <Badge
                    variant={targetApp.agentEnabled ? "secondary" : "outline"}
                  >
                    {targetApp.agentEnabled ? "agent enabled" : "disabled"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {environments.map((environment) => (
                    <div
                      key={environment.id}
                      className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Boxes className="h-4 w-4 text-muted-foreground" />
                        <span>{environment.name}</span>
                        <Badge variant="outline">{environment.kind}</Badge>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {environment.agentWritable ? (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            writable
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <ShieldAlert className="h-4 w-4 text-amber-700" />
                            locked
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
