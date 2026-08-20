import type {
  LabRequestAttentionFilter,
  LabRequestFilterState,
  LabRequestLifecycleFilter,
  LabRequestListItem,
  LabRequestSort,
} from "./contracts";
import {
  labRequestAttentionFilters,
  labRequestLifecycles,
  labRequestSorts,
} from "./contracts";

export const defaultLabRequestFilters: LabRequestFilterState = {
  query: "",
  lifecycle: "open",
  phase: null,
  priority: null,
  source: null,
  attention: "all",
  sort: "attention",
};

function oneLine(value: string | null) {
  return value?.trim().replace(/\s+/g, " ") || null;
}

function enumValue<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function parseLabRequestFilters(params: URLSearchParams): LabRequestFilterState {
  return {
    query: oneLine(params.get("q")) ?? defaultLabRequestFilters.query,
    lifecycle: enumValue<LabRequestLifecycleFilter>(
      params.get("lifecycle"),
      labRequestLifecycles,
      defaultLabRequestFilters.lifecycle,
    ),
    phase: oneLine(params.get("phase")),
    priority: oneLine(params.get("priority")),
    source: oneLine(params.get("source")),
    attention: enumValue<LabRequestAttentionFilter>(
      params.get("attention"),
      labRequestAttentionFilters,
      defaultLabRequestFilters.attention,
    ),
    sort: enumValue<LabRequestSort>(
      params.get("sort"),
      labRequestSorts,
      defaultLabRequestFilters.sort,
    ),
  };
}

export function labRequestFiltersToSearchParams(filters: LabRequestFilterState) {
  const params = new URLSearchParams();
  const query = oneLine(filters.query);
  if (query) params.set("q", query);
  if (filters.lifecycle !== defaultLabRequestFilters.lifecycle) {
    params.set("lifecycle", filters.lifecycle);
  }
  if (filters.phase) params.set("phase", filters.phase);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.source) params.set("source", filters.source);
  if (filters.attention !== defaultLabRequestFilters.attention) {
    params.set("attention", filters.attention);
  }
  if (filters.sort !== defaultLabRequestFilters.sort) params.set("sort", filters.sort);
  return params;
}

export function labRequestFiltersKey(filters: LabRequestFilterState) {
  return labRequestFiltersToSearchParams(filters).toString();
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const priorityRank: Record<string, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function attentionRank(item: LabRequestListItem) {
  if (item.attention.blocked) return 3;
  if (item.attention.required) return 2;
  if (item.run.failed) return 1;
  return 0;
}

function compareRequests(
  left: LabRequestListItem,
  right: LabRequestListItem,
  sort: LabRequestSort,
) {
  if (sort === "attention") {
    const byAttention = attentionRank(right) - attentionRank(left);
    if (byAttention) return byAttention;
  } else if (sort === "priority-desc") {
    const byPriority = (priorityRank[right.priority] ?? 0) - (priorityRank[left.priority] ?? 0);
    if (byPriority) return byPriority;
  } else if (sort === "created-desc") {
    const byCreated = timestamp(right.createdAt) - timestamp(left.createdAt);
    if (byCreated) return byCreated;
  }

  const byUpdated = timestamp(right.updatedAt) - timestamp(left.updatedAt);
  return byUpdated || right.requestNumber - left.requestNumber;
}

function matchesLifecycle(item: LabRequestListItem, lifecycle: LabRequestLifecycleFilter) {
  if (lifecycle === "all") return true;
  if (lifecycle === "open") return item.lifecycle !== "completed";
  return item.lifecycle === lifecycle;
}

function matchesAttention(item: LabRequestListItem, attention: LabRequestAttentionFilter) {
  if (attention === "all") return true;
  if (attention === "clear") return !item.attention.required;
  if (attention === "blocked") return item.attention.blocked;
  return item.attention.required;
}

export function filterAndSortLabRequests(
  requests: readonly LabRequestListItem[],
  filters: LabRequestFilterState,
) {
  const query = oneLine(filters.query)?.toLocaleLowerCase() ?? "";

  return requests
    .filter((item) => {
      if (!matchesLifecycle(item, filters.lifecycle)) return false;
      if (!matchesAttention(item, filters.attention)) return false;
      if (filters.phase && item.phase.key !== filters.phase) return false;
      if (filters.priority && item.priority !== filters.priority) return false;
      if (filters.source && item.source.key !== filters.source) return false;
      return !query || item.searchText.includes(query);
    })
    .sort((left, right) => compareRequests(left, right, filters.sort));
}

export function labRequestFilterOptions(requests: readonly LabRequestListItem[]) {
  const phaseLabels = new Map<string, string>();
  const sourceLabels = new Map<string, string>();
  const priorities = new Set<string>();

  for (const request of requests) {
    if (request.phase.key) phaseLabels.set(request.phase.key, request.phase.label);
    sourceLabels.set(request.source.key, request.source.label);
    if (request.priority) priorities.add(request.priority);
  }

  const labelEntries = (entries: Iterable<[string, string]>) =>
    [...entries]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value));

  return {
    phases: labelEntries(phaseLabels.entries()),
    priorities: [...priorities].sort(
      (left, right) => (priorityRank[right] ?? 0) - (priorityRank[left] ?? 0) || left.localeCompare(right),
    ),
    sources: labelEntries(sourceLabels.entries()),
  };
}
