"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FileSearch,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AdminSetupStatus,
} from "@/lib/admin";
import type {
  PrismArtifactDetail,
  PrismArtifactSummary,
  PrismKnowledgeDoc,
  PrismKnowledgeSearchResult,
  PrismKnowledgeSource,
} from "@/lib/prism-memory";

type ArtifactsPayload = {
  artifacts: PrismArtifactSummary[];
  total: number;
  limit: number;
};

type SourcesPayload = {
  sources: PrismKnowledgeSource[];
  total: number;
};

type KnowledgeSearchPayload =
  | { results: PrismKnowledgeSearchResult[]; total?: number }
  | { docs: PrismKnowledgeSearchResult[]; total?: number }
  | { items: PrismKnowledgeSearchResult[]; total?: number };

type SortValue =
  | "created-desc"
  | "created-asc"
  | "source-asc"
  | "type-asc"
  | "length-desc";

const artifactStatuses = ["all", "incoming", "processed", "rejected"];
const artifactCategories = ["all", "memory", "knowledge"];
const artifactLimits = ["25", "50", "100", "200"];
const sortOptions: Array<{ value: SortValue; label: string }> = [
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "source-asc", label: "Source" },
  { value: "type-asc", label: "Type" },
  { value: "length-desc", label: "Largest" },
];

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function compactHash(value?: string | null) {
  if (!value) return "None";
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

function statusVariant(status?: string | null) {
  if (status === "synced" || status === "processed" || status === "active") {
    return "secondary" as const;
  }
  if (status === "error" || status === "rejected") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function jsonPreview(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function knowledgeResults(payload: KnowledgeSearchPayload) {
  if ("results" in payload && Array.isArray(payload.results)) {
    return payload.results;
  }
  if ("docs" in payload && Array.isArray(payload.docs)) {
    return payload.docs;
  }
  if ("items" in payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function extractErrorMessage(payload: unknown, response: Response) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error
    }
    if (record.error && typeof record.error === "object") {
      const errorRecord = record.error as Record<string, unknown>
      if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
        return errorRecord.message
      }
      if (typeof errorRecord.code === "string" && errorRecord.code.trim()) {
        return errorRecord.code
      }
    }
    if (typeof record.detail === "string" && record.detail.trim()) {
      return record.detail
    }
    if (record.detail && typeof record.detail === "object") {
      const detailRecord = record.detail as Record<string, unknown>
      if (typeof detailRecord.message === "string" && detailRecord.message.trim()) {
        return detailRecord.message
      }
      if (typeof detailRecord.error === "string" && detailRecord.error.trim()) {
        return detailRecord.error
      }
    }
  }
  return `Request failed with ${response.status}`
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response));
  }

  return payload as T;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-border/70 bg-card/30 px-6 py-10 text-center">
      <FileSearch className="h-8 w-8 text-muted-foreground" />
      <p className="mt-4 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function DetailShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="border-t border-border/60 bg-card/30 xl:border-l xl:border-t-0">
      <div className="border-b border-border/60 px-5 py-4">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle ? (
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="max-h-[calc(100vh-230px)] overflow-auto p-5">
        {children}
      </div>
    </aside>
  );
}

export function MemoryExplorerWorkspace({
  setup,
}: {
  setup: AdminSetupStatus;
}) {
  const [artifacts, setArtifacts] = useState<PrismArtifactSummary[]>([]);
  const [artifactTotal, setArtifactTotal] = useState(0);
  const [selectedArtifact, setSelectedArtifact] =
    useState<PrismArtifactDetail | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("");
  const [type, setType] = useState("");
  const [artifactSearch, setArtifactSearch] = useState("");
  const [limit, setLimit] = useState("50");
  const [sortValue, setSortValue] = useState<SortValue>("created-desc");

  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeKind, setKnowledgeKind] = useState("");
  const [knowledgeTag, setKnowledgeTag] = useState("");
  const [knowledgeEntity, setKnowledgeEntity] = useState("");
  const [knowledgeResultsState, setKnowledgeResultsState] = useState<
    PrismKnowledgeSearchResult[]
  >([]);
  const [knowledgeDoc, setKnowledgeDoc] = useState<PrismKnowledgeDoc | null>(
    null,
  );
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeDetailLoading, setKnowledgeDetailLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  const [sources, setSources] = useState<PrismKnowledgeSource[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  const selectedSource = useMemo(
    () => sources.find((item) => item.id === selectedSourceId) ?? null,
    [selectedSourceId, sources],
  );

  const sourceOptions = useMemo(
    () =>
      Array.from(
        new Set(artifacts.map((artifact) => artifact.source).filter(Boolean)),
      ).sort() as string[],
    [artifacts],
  );

  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(artifacts.map((artifact) => artifact.type).filter(Boolean)),
      ).sort() as string[],
    [artifacts],
  );

  const visibleArtifacts = useMemo(() => {
    const search = artifactSearch.trim().toLowerCase();
    return artifacts
      .filter((artifact) => {
        if (search) {
          const haystack = [
            artifact.preview,
            artifact.filename,
            artifact.path,
            artifact.source,
            artifact.type,
            artifact.bucket,
            artifact.author,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (sortValue === "created-asc") {
          return left.created_at.localeCompare(right.created_at);
        }
        if (sortValue === "source-asc") {
          return (left.source ?? "").localeCompare(right.source ?? "");
        }
        if (sortValue === "type-asc") {
          return (left.type ?? "").localeCompare(right.type ?? "");
        }
        if (sortValue === "length-desc") {
          return right.content_length - left.content_length;
        }
        return right.created_at.localeCompare(left.created_at);
      });
  }, [artifactSearch, artifacts, sortValue]);

  async function loadArtifacts() {
    setArtifactLoading(true);
    setArtifactError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", limit);
      if (category !== "all") params.set("category", category);
      if (status !== "all") params.set("status", status);
      if (source.trim()) params.set("source", source.trim());
      if (type.trim()) params.set("type", type.trim());

      const payload = await fetchJson<ArtifactsPayload>(
        `/admin/memory/api/artifacts?${params.toString()}`,
      );
      setArtifacts(payload.artifacts ?? []);
      setArtifactTotal(payload.total ?? 0);
      setSelectedArtifact(null);
    } catch (error) {
      setArtifactError(
        error instanceof Error ? error.message : "Could not load artifacts",
      );
    } finally {
      setArtifactLoading(false);
    }
  }

  async function loadArtifactDetail(id: string) {
    setDetailLoading(true);
    setArtifactError(null);
    try {
      const payload = await fetchJson<PrismArtifactDetail>(
        `/admin/memory/api/artifacts/${encodeURIComponent(id)}`,
      );
      setSelectedArtifact(payload);
    } catch (error) {
      setArtifactError(
        error instanceof Error ? error.message : "Could not load artifact",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadSources() {
    setSourceLoading(true);
    setSourceError(null);
    try {
      const payload = await fetchJson<SourcesPayload>(
        "/admin/memory/api/knowledge/sources",
      );
      setSources(payload.sources ?? []);
      setSelectedSourceId((current) => current ?? payload.sources?.[0]?.id ?? null);
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Could not load sources",
      );
    } finally {
      setSourceLoading(false);
    }
  }

  async function runKnowledgeSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const params = new URLSearchParams();
      if (knowledgeQuery.trim()) params.set("q", knowledgeQuery.trim());
      if (knowledgeKind.trim()) params.set("kind", knowledgeKind.trim());
      if (knowledgeTag.trim()) params.set("tag", knowledgeTag.trim());
      if (knowledgeEntity.trim()) params.set("entity", knowledgeEntity.trim());
      params.set("limit", "25");

      const payload = await fetchJson<KnowledgeSearchPayload>(
        `/admin/memory/api/knowledge/search?${params.toString()}`,
      );
      setKnowledgeResultsState(knowledgeResults(payload));
      setKnowledgeDoc(null);
    } catch (error) {
      setKnowledgeError(
        error instanceof Error ? error.message : "Knowledge search failed",
      );
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function loadKnowledgeDoc(slug: string) {
    setKnowledgeDetailLoading(true);
    setKnowledgeError(null);
    try {
      const path = slug.split("/").map(encodeURIComponent).join("/");
      const payload = await fetchJson<PrismKnowledgeDoc>(
        `/admin/memory/api/knowledge/docs/${path}`,
      );
      setKnowledgeDoc(payload);
    } catch (error) {
      setKnowledgeError(
        error instanceof Error ? error.message : "Could not load knowledge doc",
      );
    } finally {
      setKnowledgeDetailLoading(false);
    }
  }

  useEffect(() => {
    loadArtifacts();
    loadSources();
    void runKnowledgeSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadArtifacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, source, type, limit]);

  return (
    <div className="flex min-h-[calc(100vh-65px)] flex-col">
      <div className="border-b border-border/60 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Prism Memory
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Memory Explorer
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Browse artifacts, search durable knowledge, and inspect source
              sync status without exposing Prism keys to the browser.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={setup.prismMemory.reachable ? "secondary" : "destructive"}>
              {setup.prismMemory.reachable ? "Memory reachable" : "Memory offline"}
            </Badge>
            <Badge variant="outline">
              Space {setup.prismMemory.space ?? "unknown"}
            </Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="artifacts" className="flex flex-1 flex-col">
        <div className="sticky top-16 z-20 border-b border-border/60 bg-background/95 backdrop-blur">
          <div className="px-5 py-3 md:px-6">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-transparent p-0">
              <TabsTrigger
                value="artifacts"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Artifacts
                <Badge variant="outline" className="ml-2">
                  {artifactTotal}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="knowledge"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Knowledge Search
              </TabsTrigger>
              <TabsTrigger
                value="sources"
                className="rounded-xl border border-transparent px-4 py-2.5 data-[state=active]:border-border/70 data-[state=active]:bg-background"
              >
                Sources
                <Badge variant="outline" className="ml-2">
                  {sources.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="artifacts" className="mt-0 flex-1">
          <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0">
              <div className="grid gap-3 border-b border-border/60 px-5 py-4 md:px-6 lg:grid-cols-[1.5fr_repeat(5,minmax(120px,160px))_auto]">
                <div className="space-y-2">
                  <Label>Search returned files</Label>
                  <Input
                    value={artifactSearch}
                    onChange={(event) => setArtifactSearch(event.target.value)}
                    placeholder="Search preview, filename, author..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artifactCategories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artifactStatuses.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Select value={source || "all"} onValueChange={(value) => setSource(value === "all" ? "" : value)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      {sourceOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type || "all"} onValueChange={(value) => setType(value === "all" ? "" : value)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">all</SelectItem>
                      {typeOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sort</Label>
                  <Select value={sortValue} onValueChange={(value) => setSortValue(value as SortValue)}>
                    <SelectTrigger className="border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Select value={limit} onValueChange={setLimit}>
                    <SelectTrigger className="w-24 border border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {artifactLimits.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={loadArtifacts}
                    disabled={artifactLoading}
                  >
                    {artifactLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {artifactError ? (
                <div className="border-b border-border/60 px-5 py-3 text-sm text-destructive md:px-6">
                  {artifactError}
                </div>
              ) : null}

              {visibleArtifacts.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">Created</TableHead>
                      <TableHead>File</TableHead>
                      <TableHead className="w-32">Source</TableHead>
                      <TableHead className="w-36">Type</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-24 text-right">Chars</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleArtifacts.map((artifact) => (
                      <TableRow
                        key={artifact.id}
                        className="cursor-pointer"
                        data-state={selectedArtifact?.id === artifact.id ? "selected" : undefined}
                        onClick={() => loadArtifactDetail(artifact.id)}
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(artifact.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {artifact.filename}
                            </p>
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {artifact.preview || artifact.path}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{artifact.source ?? "unknown"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {artifact.type ?? "unknown"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(artifact.status)}>
                            {artifact.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {artifact.content_length.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-5 md:p-6">
                  <EmptyState
                    title={artifactLoading ? "Loading artifacts" : "No artifacts found"}
                    body="Try a wider filter set or confirm Prism Memory has inbox or knowledge artifacts."
                  />
                </div>
              )}
            </div>

            <DetailShell
              title={selectedArtifact?.filename ?? "Artifact Detail"}
              subtitle={selectedArtifact?.path}
            >
              {detailLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading artifact...
                </div>
              ) : selectedArtifact ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant(selectedArtifact.status)}>
                      {selectedArtifact.status}
                    </Badge>
                    <Badge variant="outline">{selectedArtifact.category}</Badge>
                    <Badge variant="outline">{selectedArtifact.source ?? "unknown"}</Badge>
                  </div>
                  {selectedArtifact.url ? (
                    <Button asChild variant="outline">
                      <a href={selectedArtifact.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Source
                      </a>
                    </Button>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Content
                    </p>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap border border-border bg-background/70 p-3 text-xs leading-5">
                      {selectedArtifact.content || selectedArtifact.preview}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Raw Payload
                    </p>
                    <pre className="max-h-96 overflow-auto border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
                      {jsonPreview(selectedArtifact.payload)}
                    </pre>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Select an artifact"
                  body="Choose a row to inspect content, provenance, and the raw JSON payload."
                />
              )}
            </DetailShell>
          </section>
        </TabsContent>

        <TabsContent value="knowledge" className="mt-0 flex-1">
          <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0">
              <form
                className="grid gap-3 border-b border-border/60 px-5 py-4 md:px-6 lg:grid-cols-[1.5fr_repeat(3,minmax(140px,180px))_auto]"
                onSubmit={runKnowledgeSearch}
              >
                <div className="space-y-2">
                  <Label>Question or keyword</Label>
                  <Input
                    value={knowledgeQuery}
                    onChange={(event) => setKnowledgeQuery(event.target.value)}
                    placeholder="Search handbook, notes, policies..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Kind</Label>
                  <Input
                    value={knowledgeKind}
                    onChange={(event) => setKnowledgeKind(event.target.value)}
                    placeholder="guide"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tag</Label>
                  <Input
                    value={knowledgeTag}
                    onChange={(event) => setKnowledgeTag(event.target.value)}
                    placeholder="onboarding"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Entity</Label>
                  <Input
                    value={knowledgeEntity}
                    onChange={(event) => setKnowledgeEntity(event.target.value)}
                    placeholder="Prism"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={knowledgeLoading}>
                    {knowledgeLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Search
                  </Button>
                </div>
              </form>

              {knowledgeError ? (
                <div className="border-b border-border/60 px-5 py-3 text-sm text-destructive md:px-6">
                  {knowledgeError}
                </div>
              ) : null}

              {knowledgeResultsState.length ? (
                <div className="divide-y divide-border/60">
                  {knowledgeResultsState.map((result, index) => (
                    <button
                      key={`${result.slug ?? result.title ?? index}`}
                      type="button"
                      className="block w-full px-5 py-4 text-left hover:bg-muted/40 md:px-6"
                      onClick={() => result.slug && loadKnowledgeDoc(result.slug)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">
                          {result.title ?? result.slug ?? "Untitled doc"}
                        </p>
                        {result.kind ? (
                          <Badge variant="outline">{result.kind}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {result.summary ?? result.slug}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(result.tags ?? []).slice(0, 6).map((tag) => (
                          <Badge key={tag} variant="muted">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-5 md:p-6">
                  <EmptyState
                    title={knowledgeLoading ? "Searching knowledge" : "No knowledge results"}
                    body="Search all indexed knowledge or narrow by kind, tag, or entity."
                  />
                </div>
              )}
            </div>

            <DetailShell
              title={knowledgeDoc?.title ?? "Knowledge Detail"}
              subtitle={knowledgeDoc?.slug}
            >
              {knowledgeDetailLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading document...
                </div>
              ) : knowledgeDoc ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    {knowledgeDoc.kind ? (
                      <Badge variant="outline">{knowledgeDoc.kind}</Badge>
                    ) : null}
                    {(knowledgeDoc.tags ?? []).slice(0, 6).map((tag) => (
                      <Badge key={tag} variant="muted">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {knowledgeDoc.source_url ? (
                    <Button asChild variant="outline">
                      <a href={knowledgeDoc.source_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Source
                      </a>
                    </Button>
                  ) : null}
                  <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap border border-border bg-background/70 p-3 text-xs leading-5">
                    {knowledgeDoc.content ?? knowledgeDoc.summary ?? ""}
                  </pre>
                  <pre className="max-h-80 overflow-auto border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
                    {jsonPreview(knowledgeDoc)}
                  </pre>
                </div>
              ) : (
                <EmptyState
                  title="Select a knowledge result"
                  body="Open a result to inspect its content, source metadata, tags, and entities."
                />
              )}
            </DetailShell>
          </section>
        </TabsContent>

        <TabsContent value="sources" className="mt-0 flex-1">
          <section className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_430px]">
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-6">
                <div>
                  <h2 className="text-lg font-semibold">Knowledge Sources</h2>
                  <p className="text-sm text-muted-foreground">
                    Read-only status for repo-backed Prism Knowledge sources.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={loadSources}
                  disabled={sourceLoading}
                >
                  {sourceLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Refresh
                </Button>
              </div>

              {sourceError ? (
                <div className="border-b border-border/60 px-5 py-3 text-sm text-destructive md:px-6">
                  {sourceError}
                </div>
              ) : null}

              {sources.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="w-28">Kind</TableHead>
                      <TableHead className="w-36">Status</TableHead>
                      <TableHead className="w-28 text-right">Docs</TableHead>
                      <TableHead className="w-40">Synced</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((item) => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer"
                        data-state={selectedSourceId === item.id ? "selected" : undefined}
                        onClick={() => setSelectedSourceId(item.id)}
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{item.label}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.repo_url}#{item.branch}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{item.kind}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(item.state?.status ?? item.status)}>
                            {item.state?.status ?? item.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.state?.doc_count ?? 0}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(item.last_synced_at ?? item.state?.last_synced_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-5 md:p-6">
                  <EmptyState
                    title={sourceLoading ? "Loading sources" : "No sources registered"}
                    body="Repo-backed knowledge sources will appear here after they are registered in Prism Memory."
                  />
                </div>
              )}
            </div>

            <DetailShell
              title={selectedSource?.label ?? "Source Detail"}
              subtitle={selectedSource?.id}
            >
              {selectedSource ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="border border-border bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Docs
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {selectedSource.state?.doc_count ?? 0}
                      </p>
                    </div>
                    <div className="border border-border bg-background/70 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        Files
                      </p>
                      <p className="mt-1 text-2xl font-semibold">
                        {selectedSource.state?.file_count ?? 0}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">Repo:</span>{" "}
                      <span className="break-all">{selectedSource.repo_url}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Branch:</span>{" "}
                      {selectedSource.branch}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Commit:</span>{" "}
                      {compactHash(selectedSource.last_synced_commit ?? selectedSource.state?.last_synced_commit)}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Last synced:</span>{" "}
                      {formatDate(selectedSource.last_synced_at ?? selectedSource.state?.last_synced_at)}
                    </p>
                  </div>
                  {selectedSource.state?.error ? (
                    <div className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                      {selectedSource.state.error.code ? `${selectedSource.state.error.code}: ` : ""}
                      {selectedSource.state.error.message ?? "Unknown source error"}
                    </div>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      Docs Roots
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(selectedSource.docs_roots.length
                        ? selectedSource.docs_roots
                        : selectedSource.state?.docs_roots ?? []
                      ).map((root) => (
                        <Badge key={root} variant="outline">
                          {root}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <pre className="max-h-96 overflow-auto border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
                    {jsonPreview(selectedSource)}
                  </pre>
                </div>
              ) : (
                <EmptyState
                  title="Select a source"
                  body="Choose a source to inspect sync state, docs roots, patterns, and recent errors."
                />
              )}
            </DetailShell>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
