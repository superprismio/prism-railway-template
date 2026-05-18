"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { BookOpen, ChevronDown, Eye, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

type SkillRecord = {
  name: string;
  path: string;
  description: string | null;
  source: "site" | "custom";
  kind: "built-in" | "custom";
  readOnly: boolean;
};

type SkillsPayload = {
  ok?: boolean;
  skills?: SkillRecord[];
  error?: string;
};

type SkillContentPayload = {
  ok?: boolean;
  name?: string;
  content?: string;
  error?: string;
};

type DeleteSkillPayload = {
  ok?: boolean;
  error?: string;
};

function sourceLabel(source: SkillRecord["source"]) {
  if (source === "custom") return "site volume";
  return "site";
}

export function SkillsWorkspace() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillRecord | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>("");
  const [isViewing, setIsViewing] = useState(false);
  const [isBuiltInOpen, setIsBuiltInOpen] = useState(false);
  const [isRefreshing, startRefresh] = useTransition();

  async function loadSkills() {
    const response = await fetch("/admin/skills", { cache: "no-store" });
    const payload = (await response.json()) as SkillsPayload;
    if (!response.ok || !payload.ok || !Array.isArray(payload.skills)) {
      throw new Error(payload.error || "Could not load skills");
    }
    setSkills(payload.skills);
    setError(null);
  }

  function refresh() {
    setError(null);
    startRefresh(async () => {
      try {
        await loadSkills();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Could not load skills");
      }
    });
  }

  async function viewSkill(skill: SkillRecord) {
    setSelectedSkill(skill);
    setSelectedContent("");
    setIsViewing(true);
    try {
      const response = await fetch(`/admin/skills/${encodeURIComponent(skill.name)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as SkillContentPayload;
      if (!response.ok || !payload.ok || typeof payload.content !== "string") {
        throw new Error(payload.error || "Could not load skill");
      }
      setSelectedContent(payload.content);
    } catch (nextError) {
      setSelectedContent(nextError instanceof Error ? nextError.message : "Could not load skill");
    }
  }

  async function deleteSkill(skill: SkillRecord) {
    if (skill.kind !== "custom") return;
    const confirmed = window.confirm(`Delete custom skill "${skill.name}"?`);
    if (!confirmed) return;

    setError(null);
    try {
      const response = await fetch(`/admin/skills/${encodeURIComponent(skill.name)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as DeleteSkillPayload;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not delete skill");
      }
      setSkills((current) => current.filter((currentSkill) => currentSkill.name !== skill.name));
      if (selectedSkill?.name === skill.name) {
        setSelectedSkill(null);
        setSelectedContent("");
        setIsViewing(false);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not delete skill");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(
    () => ({
      total: skills.length,
      builtIn: skills.filter((skill) => skill.kind === "built-in").length,
      custom: skills.filter((skill) => skill.kind === "custom").length,
    }),
    [skills],
  );
  const customSkills = useMemo(() => skills.filter((skill) => skill.kind === "custom"), [skills]);
  const builtInSkills = useMemo(() => skills.filter((skill) => skill.kind === "built-in"), [skills]);

  function renderSkill(skill: SkillRecord) {
    return (
      <div
        key={`${skill.source}:${skill.name}`}
        className="grid gap-4 border border-border/70 bg-background p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,340px)_auto]"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">{skill.name}</h2>
            <Badge variant={skill.kind === "custom" ? "default" : "outline"}>
              {skill.kind}
            </Badge>
            <Badge variant="outline">{sourceLabel(skill.source)}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {skill.description || "No description found."}
          </p>
        </div>
        <div className="min-w-0 self-center text-xs text-muted-foreground">
          <p className="truncate">{skill.path}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => viewSkill(skill)}>
            <Eye className="h-4 w-4" />
            View
          </Button>
          {skill.kind === "custom" ? (
            <Button type="button" variant="destructive" onClick={() => deleteSkill(skill)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 px-5 py-5 md:px-6">
      <section className="grid gap-3 md:grid-cols-3">
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Skills</p>
          <p className="mt-2 text-3xl font-semibold">{counts.total}</p>
        </div>
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Built-In</p>
          <p className="mt-2 text-3xl font-semibold">{counts.builtIn}</p>
        </div>
        <div className="border border-border/70 bg-background p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Custom</p>
          <p className="mt-2 text-3xl font-semibold">{counts.custom}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Available Skills</p>
          <p className="text-sm text-muted-foreground">
            Built-ins come from the template. Custom skills are discovered from /data/skills.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Custom Skills</p>
            <p className="text-sm text-muted-foreground">Instance-owned skills from the site volume.</p>
          </div>
          <Badge variant="outline">{customSkills.length}</Badge>
        </div>
        {customSkills.map(renderSkill)}
        {!customSkills.length && !error ? (
          <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
            No custom skills discovered.
          </div>
        ) : null}
      </section>

      <Collapsible open={isBuiltInOpen} onOpenChange={setIsBuiltInOpen} className="grid gap-3">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" className="justify-between">
            <span>Built-In Skills</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {builtInSkills.length}
              <ChevronDown className={`h-4 w-4 transition-transform ${isBuiltInOpen ? "rotate-180" : ""}`} />
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3">
          {builtInSkills.map(renderSkill)}
          {!builtInSkills.length && !error ? (
            <div className="border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
              No built-in skills discovered.
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      <section className="grid gap-3">
        {!skills.length && !error ? (
          <div className="border border-border/70 bg-background px-4 py-8 text-sm text-muted-foreground">
            No skills discovered.
          </div>
        ) : null}
      </section>

      <Dialog open={isViewing} onOpenChange={setIsViewing}>
        <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl min-w-0 flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="min-w-0 truncate pr-8">
              {selectedSkill?.name ?? "Skill"}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 overflow-x-auto border border-border/70 bg-muted/20">
            <pre className="max-w-full whitespace-pre-wrap break-words p-4 text-xs leading-6">
              {selectedContent || "Loading..."}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
