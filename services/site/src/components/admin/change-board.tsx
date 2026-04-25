"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  BotMessageSquare,
  FilePlus,
  GitGraph,
  LogOut,
  Rows3,
  Settings,
  X,
} from "lucide-react";

import { AdminHeader } from "@/components/admin/admin-header";
import { ChangeRequestList } from "@/components/admin/change-request-list";
import { RequestDetailsPanel } from "@/components/admin/change-request-details-panel";
import { CodexConsole } from "@/components/admin/codex-console";
import { NewChangeRequestDialog } from "@/components/admin/new-change-request-dialog";
import { ReposWorkspace } from "@/components/admin/repos-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AdminBoardData } from "@/lib/admin";

import {
  environmentForRequest,
  parseTimestamp,
  priorityVariant,
  requestTypeLabel,
  statusLabel,
  statusVariant,
  targetAppForRequest,
  type RequestSortValue,
} from "./change-request-utils";

export function ChangeBoard({ data: initialData }: { data: AdminBoardData }) {
  const [data, setData] = useState(initialData);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [repositoryFilter, setRepositoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortValue, setSortValue] =
    useState<RequestSortValue>("updated-desc");
  const [isSaving, startSaving] = useTransition();
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshBoard() {
      try {
        const response = await fetch("/admin/board", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          ok: true;
          data: AdminBoardData;
        };
        if (!cancelled && payload.ok) {
          setData(payload.data);
        }
      } catch {
        // Leave the current board state in place and try again on the next interval.
      }
    }

    refreshBoard();
    const intervalId = window.setInterval(refreshBoard, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const closedCount = data.changeRequests.filter((request) =>
    ["approved", "rejected", "closed"].includes(request.status),
  ).length;
  const activeCount = data.changeRequests.filter(
    (request) => !["approved", "rejected", "closed"].includes(request.status),
  ).length;

  const selectedRequest = useMemo(
    () =>
      data.changeRequests.find((request) => request.id === selectedRequestId) ??
      null,
    [data.changeRequests, selectedRequestId],
  );
  const selectedTargetApp = selectedRequest
    ? targetAppForRequest(selectedRequest, data.targetApps)
    : null;
  const selectedTargetEnvironment = selectedRequest
    ? environmentForRequest(selectedRequest, data.targetEnvironments)
    : null;

  const requestTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(data.changeRequests.map((request) => request.requestType)),
      ).sort((left, right) => left.localeCompare(right)),
    [data.changeRequests],
  );

  async function refreshOnce() {
    const response = await fetch("/admin/board", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Board refresh failed");
    }

    const payload = (await response.json()) as {
      ok: true;
      data: AdminBoardData;
    };
    if (!payload.ok) {
      throw new Error("Board refresh failed");
    }

    setData(payload.data);
  }

  function handleSaveTriage(payload: {
    status: string;
    triageSummary: string;
    agentRecommendation: string;
  }) {
    if (!selectedRequest) return;

    setModalError(null);
    startSaving(async () => {
      try {
        const response = await fetch(
          `/admin/change-requests/${selectedRequest.id}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const responsePayload = (await response.json()) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || responsePayload.ok === false) {
          throw new Error(responsePayload.error || "Could not save triage");
        }

        await refreshOnce();
      } catch (error) {
        setModalError(
          error instanceof Error ? error.message : "Could not save triage",
        );
      }
    });
  }

  const taskList = useMemo(
    () => {
      const normalizedSearch = searchQuery.trim().toLocaleLowerCase();

      return data.changeRequests
        .filter((request) => {
          if (statusFilter !== "all" && request.status !== statusFilter) {
            return false;
          }

          if (typeFilter !== "all" && request.requestType !== typeFilter) {
            return false;
          }

          if (
            repositoryFilter !== "all" &&
            request.targetAppId !== repositoryFilter
          ) {
            return false;
          }

          if (
            normalizedSearch &&
            !request.title.toLocaleLowerCase().includes(normalizedSearch)
          ) {
            return false;
          }

          return true;
        })
        .sort((left, right) => {
          if (sortValue === "number-desc") {
            return right.requestNumber - left.requestNumber;
          }

          if (sortValue === "number-asc") {
            return left.requestNumber - right.requestNumber;
          }

          const leftUpdated = parseTimestamp(left.updatedAt);
          const rightUpdated = parseTimestamp(right.updatedAt);

          if (sortValue === "updated-asc") {
            return leftUpdated - rightUpdated;
          }

          return rightUpdated - leftUpdated;
        });
    },
    [
      data.changeRequests,
      repositoryFilter,
      searchQuery,
      sortValue,
      statusFilter,
      typeFilter,
    ],
  );

  return (
    <main className="min-h-screen w-full bg-background text-foreground">
      <AdminHeader
        actions={
          <>
            <Button type="button" onClick={() => setIsNewRequestOpen(true)}>
              <FilePlus className="h-4 w-4" />
              <span className="hidden sm:inline">Add Change Request</span>
            </Button>
            <Button asChild variant="outline">
              <a href="/admin/settings">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Settings</span>
              </a>
            </Button>
            <form action="/admin/logout" method="post">
              <Button variant="outline" type="submit">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Exit admin</span>
              </Button>
            </form>
          </>
        }
      />

      <Tabs
        defaultValue="change-requests"
        className="flex min-h-[calc(100vh-65px)] flex-col"
      >
        <div className="sticky top-16 z-20 border-b border-border/60 bg-background/95 backdrop-blur">
          <div className="px-5 py-3 md:px-6">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-transparent p-0">
              <TabsTrigger
                value="change-requests"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                <Rows3 className="h-4 w-4 md:hidden" />
                <span className="hidden md:inline">Change Requests</span>
                <Badge variant="outline" className="ml-2 hidden md:inline-flex">
                  {taskList.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="codex-console"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                <BotMessageSquare className="h-4 w-4 md:hidden" />
                <span className="hidden md:inline">Codex Console</span>
              </TabsTrigger>
              <TabsTrigger
                value="snapshot"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                <GitGraph className="h-4 w-4 md:hidden" />
                <span className="hidden md:inline">Repos</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="change-requests" className="mt-0 flex-1">
          <section
            className={`grid min-h-full gap-0 ${
              selectedRequest ? "" : "xl:grid-cols-[minmax(0,1fr)_360px]"
            }`}
          >
            <div
              className={`border-b border-border/60 xl:border-b-0 ${
                selectedRequest ? "" : "xl:border-r"
              }`}
            >
              <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 md:px-6">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {selectedRequest
                      ? `#${selectedRequest.requestNumber} ${selectedRequest.title}`
                      : "Change Requests"}
                  </h1>
                  {selectedRequest ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(selectedRequest.status)}>
                        {statusLabel(selectedRequest.status)}
                      </Badge>
                      <Badge variant={priorityVariant(selectedRequest.priority)}>
                        {selectedRequest.priority}
                      </Badge>
                      <Badge variant="outline">
                        {requestTypeLabel(selectedRequest.requestType)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {selectedTargetApp?.name ??
                          selectedRequest.targetAppSlug ??
                          "Unknown target"}
                        {selectedTargetEnvironment
                          ? ` / ${selectedTargetEnvironment.name}`
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Open a request to review context, comments, execution
                      history, and agent controls.
                    </p>
                  )}
                </div>
                {selectedRequest ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedRequestId(null);
                      setModalError(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                    Close
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => setIsNewRequestOpen(true)}
                  >
                    <FilePlus className="h-4 w-4" />
                    Add Change Request
                  </Button>
                )}
              </div>

              {selectedRequest ? (
                <ScrollArea className="h-[calc(100vh-190px)]">
                  <RequestDetailsPanel
                    request={selectedRequest}
                    targetApp={selectedTargetApp}
                    targetEnvironment={selectedTargetEnvironment}
                    isPending={isSaving}
                    error={modalError}
                    onClose={() => {
                      setSelectedRequestId(null);
                      setModalError(null);
                    }}
                    onSave={handleSaveTriage}
                  />
                </ScrollArea>
              ) : (
                <ChangeRequestList
                  requests={taskList}
                  targetApps={data.targetApps}
                  targetEnvironments={data.targetEnvironments}
                  requestTypeOptions={requestTypeOptions}
                  statusFilter={statusFilter}
                  typeFilter={typeFilter}
                  repositoryFilter={repositoryFilter}
                  searchQuery={searchQuery}
                  sortValue={sortValue}
                  onStatusFilterChange={setStatusFilter}
                  onTypeFilterChange={setTypeFilter}
                  onRepositoryFilterChange={setRepositoryFilter}
                  onSearchQueryChange={setSearchQuery}
                  onSortValueChange={setSortValue}
                  onOpenRequest={(nextRequest) => {
                    setSelectedRequestId(nextRequest.id);
                    setModalError(null);
                  }}
                />
              )}
            </div>

            {!selectedRequest ? (
              <aside className="flex flex-col bg-card/30">
                <div className="border-b border-border/60 px-5 py-4 md:px-6">
                  <p className="text-sm font-medium">Workspace Snapshot</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Quick read on activity while you triage the board.
                  </p>
                </div>
                <div className="grid gap-3 px-5 py-4 md:px-6">
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Active
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {activeCount}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Closed
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {closedCount}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Repositories
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {data.targetApps.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Environments
                    </p>
                    <p className="mt-2 text-3xl font-semibold">
                      {data.targetEnvironments.length}
                    </p>
                  </div>
                </div>
              </aside>
            ) : null}
          </section>
        </TabsContent>

        <TabsContent value="codex-console" className="mt-0 flex-1">
          <section className="min-h-full">
            <div className="border-b border-border/60 px-5 py-4 md:px-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                Codex Console
              </h1>
              <p className="text-sm text-muted-foreground">
                Work directly with Codex on request context, review state, and
                implementation planning.
              </p>
            </div>

            <CodexConsole />
          </section>
        </TabsContent>

        <TabsContent value="snapshot" className="mt-0 flex-1">
          <section className="min-h-full">
            <div className="border-b border-border/60 px-5 py-4 md:px-6">
              <h1 className="text-2xl font-semibold tracking-tight">Repos</h1>
              <p className="text-sm text-muted-foreground">
                Review repository targets, writable environments, and the
                current board footprint.
              </p>
            </div>

            <ReposWorkspace
              targetApps={data.targetApps}
              targetEnvironments={data.targetEnvironments}
              activeCount={activeCount}
              closedCount={closedCount}
            />
          </section>
        </TabsContent>
      </Tabs>

      <NewChangeRequestDialog
        open={isNewRequestOpen}
        onOpenChange={setIsNewRequestOpen}
        targetApps={data.targetApps}
      />
    </main>
  );
}
