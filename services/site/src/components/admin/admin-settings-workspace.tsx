"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Activity,
  Bot,
  GitBranch,
  KeyRound,
  ShieldAlert,
  UserPlus,
  Users,
  Palette,
} from "lucide-react";

import { ReposWorkspace } from "@/components/admin/repos-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdminSetupStatus,
  TargetAppRecord,
  TargetEnvironmentRecord,
} from "@/lib/admin";
import type { Capability, RoleSlug } from "@/lib/role-access";

type AdminMember = {
  id: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  isBanned: boolean;
  isSeeded: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  pointsTotal: number;
  roleSlugs: RoleSlug[];
};

type AdminBranding = {
  brandName: string;
  logoUrl: string;
  logoAlt: string;
  workspaceLabel: string;
};

const managedRoleOptions: Array<{ value: RoleSlug; label: string; description: string }> = [
  { value: "admin", label: "Admin", description: "Full instance ownership controls." },
  { value: "moderator", label: "Moderator", description: "Operational workspace controls." },
  { value: "member", label: "Member", description: "Read-mostly workspace access." },
];

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusBadge(ok: boolean, label?: string) {
  return (
    <Badge
      variant={ok ? "secondary" : "muted"}
      className={
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : undefined
      }
    >
      {ok ? label ?? "Ready" : label ?? "Needs setup"}
    </Badge>
  );
}

function copyBlock(lines: string[]) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-[var(--code-surface)] p-3 text-xs leading-5 text-[var(--code-surface-foreground)]">
      {lines.join("\n")}
    </pre>
  );
}

function SetupStatus({ setup }: { setup: AdminSetupStatus }) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Prism Memory
          </CardTitle>
          <CardDescription>
            Memory API reachability and active space.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {statusBadge(setup.prismMemory.reachable)}
          <p className="text-sm text-muted-foreground">
            Space:{" "}
            <span className="font-medium text-foreground">
              {setup.prismMemory.space ?? "unknown"}
            </span>
          </p>
          {setup.prismMemory.error ? (
            <p className="text-sm text-destructive">
              {setup.prismMemory.error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Codex Runtime
          </CardTitle>
          <CardDescription>
            Runtime health and persisted device auth.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {statusBadge(
              setup.codexRuntime.reachable,
              setup.codexRuntime.reachable ? "Reachable" : "Unreachable",
            )}
            {statusBadge(
              setup.codexRuntime.codexAuthConfigured,
              setup.codexRuntime.codexAuthConfigured
                ? "Auth configured"
                : "Auth needed",
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Home:{" "}
            <span className="font-medium text-foreground">
              {setup.codexRuntime.codexHome ?? "not reported"}
            </span>
          </p>
          {!setup.codexRuntime.codexAuthConfigured
            ? copyBlock([
                "railway ssh -s codex-runtime",
                "mkdir -p /data/codex",
                "export CODEX_HOME=/data/codex",
                'export PATH="/app/node_modules/.bin:$PATH"',
                "codex login --device-auth",
              ])
            : null}
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" />
            Target Repos
          </CardTitle>
          <CardDescription>
            App-owned target metadata for Codex workspaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Apps
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {setup.targets.targetAppCount}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Envs
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {setup.targets.targetEnvironmentCount}
              </p>
            </div>
          </div>
          {statusBadge(
            setup.targets.targetAppCount > 0 &&
              setup.targets.targetEnvironmentCount > 0,
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EnvironmentInstructions() {
  const serviceLabel = (name: string) => (
    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      Railway service: {name}
    </p>
  );

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Discord Optional
          </CardTitle>
          <CardDescription>
            Set these in Railway only when enabling Discord chat or sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {serviceLabel("discord-adapter")}
          {copyBlock([
            'DISCORD_BOT_TOKEN=""',
            'DISCORD_GUILD_ID=""',
            'DISCORD_APPLICATION_ID=""',
            'PRISM_TRIGGER_DISABLED="true"',
          ])}
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" />
            Voice Optional
          </CardTitle>
          <CardDescription>
            Discord recording stays disabled until the transcription key is set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {serviceLabel("discord-adapter")}
          {copyBlock([
            'VOICE_DAVE_ENCRYPTION="true"',
            'VOICE_TRANSCRIPTION_BASE_URL="https://api.venice.ai/api/v1/audio/transcriptions"',
            'VOICE_TRANSCRIPTION_API_KEY=""',
            'VOICE_TRANSCRIPTION_MODEL="nvidia/parakeet-tdt-0.6b-v3"',
          ])}
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4" />
            GitHub Push Access
          </CardTitle>
          <CardDescription>
            Only needed for private repos or branch pushes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {serviceLabel("codex-runtime")}
          {copyBlock(['TARGET_REPO_GITHUB_TOKEN=""'])}
        </CardContent>
      </Card>
    </section>
  );
}

function BrandingSettings({
  branding,
  onBrandingChange,
}: {
  branding: AdminBranding;
  onBrandingChange: (branding: AdminBranding) => void;
}) {
  const [draft, setDraft] = useState(branding);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDraft(branding);
  }, [branding]);

  function saveBranding() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/admin/branding", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          branding?: AdminBranding;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not save branding");
        }
        if (payload.branding) {
          const nextBranding = {
            brandName: payload.branding.brandName,
            logoUrl: payload.branding.logoUrl,
            logoAlt: payload.branding.logoAlt,
            workspaceLabel: payload.branding.workspaceLabel,
          };
          setDraft(nextBranding);
          onBrandingChange(nextBranding);
        }
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Could not save branding");
      }
    });
  }

  return (
    <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="h-4 w-4" />
          Instance Branding
        </CardTitle>
        <CardDescription>
          Set the header name, workspace label, and logo for this instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? (
          <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-none border border-border/70 bg-muted/40">
            {draft.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.logoUrl} alt={draft.logoAlt || "Logo preview"} className="h-full w-full object-contain p-1" />
            ) : (
              <Palette className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand-name">Brand name</Label>
              <Input
                id="brand-name"
                value={draft.brandName}
                onChange={(event) => setDraft((current) => ({ ...current, brandName: event.target.value }))}
                placeholder="Prism Refactory"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-label">Workspace label</Label>
              <Input
                id="workspace-label"
                value={draft.workspaceLabel}
                onChange={(event) => setDraft((current) => ({ ...current, workspaceLabel: event.target.value }))}
                placeholder="Admin workspace"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="logo-url">Logo URL</Label>
              <Input
                id="logo-url"
                value={draft.logoUrl}
                onChange={(event) => setDraft((current) => ({ ...current, logoUrl: event.target.value }))}
                placeholder="https://... or data:image/..."
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="logo-alt">Logo alt text</Label>
              <Input
                id="logo-alt"
                value={draft.logoAlt}
                onChange={(event) => setDraft((current) => ({ ...current, logoAlt: event.target.value }))}
                placeholder="Workspace logo"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={saveBranding} disabled={isPending}>
            Save branding
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MembersAndRoles({
  canManageUsers,
}: {
  canManageUsers: boolean;
}) {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [claimLink, setClaimLink] = useState<{ label: string; url: string; expiresAt: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  async function loadMembers() {
    if (!canManageUsers) return;
    try {
      const response = await fetch("/admin/members", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        users?: AdminMember[];
        error?: string;
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "Could not load members");
      }
      setMembers(payload.users ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load members");
    }
  }

  useEffect(() => {
    void loadMembers();
  }, [canManageUsers]);

  function toggleRole(member: AdminMember, role: RoleSlug) {
    const nextRoles = member.roleSlugs.includes(role)
      ? member.roleSlugs.filter((value) => value !== role)
      : [...member.roleSlugs, role];
    const normalizedRoles = nextRoles.length ? nextRoles : ["member" as const];

    startTransition(async () => {
      try {
        const response = await fetch("/admin/members", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: member.id, roleSlugs: normalizedRoles }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not update roles");
        }
        await loadMembers();
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : "Could not update roles");
      }
    });
  }

  function createMember() {
    const email = newEmail.trim();
    if (!email) {
      setError("Email is required");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/admin/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            displayName: newDisplayName.trim() || null,
            roleSlugs: ["member"],
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          invite?: { claimUrl?: string; expiresAt?: string };
          error?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.error || "Could not create member");
        }
        setNewEmail("");
        setNewDisplayName("");
        if (payload.invite?.claimUrl) {
          setClaimLink({
            label: "Invite link",
            url: payload.invite.claimUrl,
            expiresAt: payload.invite.expiresAt ?? "",
          });
        }
        await loadMembers();
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : "Could not create member");
      }
    });
  }

  function createResetLink(member: AdminMember) {
    startTransition(async () => {
      try {
        const response = await fetch("/admin/member-invites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: member.id,
            kind: "reset",
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          invite?: { claimUrl?: string; expiresAt?: string };
          error?: string;
        };
        if (!response.ok || payload.ok === false || !payload.invite?.claimUrl) {
          throw new Error(payload.error || "Could not create reset link");
        }
        setClaimLink({
          label: `Reset link for ${member.email ?? member.displayName ?? member.id}`,
          url: payload.invite.claimUrl,
          expiresAt: payload.invite.expiresAt ?? "",
        });
      } catch (resetError) {
        setError(resetError instanceof Error ? resetError.message : "Could not create reset link");
      }
    });
  }

  if (!canManageUsers) {
    return (
      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Members & Roles
          </CardTitle>
          <CardDescription>Only admins can manage member roles.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Members & Roles
        </CardTitle>
        <CardDescription>
          Manage app roles for signed-in workspace users. Invite and password reset flows are still pending.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div className="rounded-none border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 rounded-none border border-border/70 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="member-email">Email</Label>
            <Input
              id="member-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="member@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-display-name">Display name</Label>
            <Input
              id="member-display-name"
              value={newDisplayName}
              onChange={(event) => setNewDisplayName(event.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={createMember} disabled={isPending}>
              <UserPlus className="h-4 w-4" />
              Add member
            </Button>
          </div>
        </div>

        {claimLink ? (
          <div className="space-y-3 rounded-none border border-primary/40 bg-primary/5 p-4">
            <div>
              <p className="font-medium">{claimLink.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Copy this link manually. It expires {formatDate(claimLink.expiresAt)}.
              </p>
            </div>
            <Input readOnly value={claimLink.url} onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}

        <div className="grid gap-3">
          {members.map((member) => (
            <div
              key={member.id}
              className="grid gap-4 rounded-none border border-border/70 bg-background/70 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,auto)]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {member.displayName || member.handle || member.email || member.id}
                  </p>
                  {member.roleSlugs.map((role) => (
                    <Badge key={role} variant={role === "admin" ? "secondary" : "outline"}>
                      {role}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {member.email ?? "No email"} - Last seen {formatDate(member.lastSeenAt)}
                </p>
                {!member.claimedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Invite/reset flow pending. This account is managed but not claimed.
                  </p>
                ) : null}
              </div>
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {managedRoleOptions.map((role) => (
                    <label
                      key={role.value}
                      className="flex min-h-20 cursor-pointer flex-col gap-2 rounded-none border border-border/70 p-3 text-sm"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <input
                          type="checkbox"
                          checked={member.roleSlugs.includes(role.value)}
                          onChange={() => toggleRole(member, role.value)}
                          disabled={isPending}
                          className="h-4 w-4 accent-primary"
                        />
                        {role.label}
                      </span>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {role.description}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => createResetLink(member)}
                    disabled={isPending}
                  >
                    <KeyRound className="h-4 w-4" />
                    Create reset link
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!members.length ? (
            <div className="rounded-none border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No members found.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RepositorySetup({
  targetApps,
  targetEnvironments,
}: {
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle>Repository Target</CardTitle>
          <CardDescription>
            Create one Codex target. Change request branches start from the
            target branch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/admin/target-apps" method="post" className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input name="name" placeholder="DAOhaus Admin" required />
            </div>
            <div className="space-y-2">
              <Label>GitHub Repo URL</Label>
              <Input
                name="repoUrl"
                placeholder="https://github.com/HausDAO/daohaus-admin.git"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Target Branch</Label>
              <Input name="defaultBranch" defaultValue="main" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                name="description"
                placeholder="What this target repo represents."
              />
            </div>
            <Button type="submit">Create repository target</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle>Current Targets</CardTitle>
          <CardDescription>
            Repositories available in the New Change Request form.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {targetApps.length ? (
            targetApps.map((targetApp) => {
              const environments = targetEnvironments.filter(
                (environment) => environment.targetAppId === targetApp.id,
              );
              const defaultEnvironment =
                environments.find((environment) => environment.isDefaultForAgent) ??
                environments[0];
              return (
                <div
                  key={targetApp.id}
                  className="rounded-xl border border-border bg-background/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{targetApp.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {targetApp.repoUrl ?? "No repo URL"}
                      </p>
                    </div>
                    <Badge variant={targetApp.agentEnabled ? "secondary" : "muted"}>
                      {targetApp.agentEnabled ? "Agent on" : "Agent off"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <span>
                      Target branch:{" "}
                      <span className="font-medium text-foreground">
                        {defaultEnvironment?.branch ??
                          targetApp.defaultBranch ??
                          "main"}
                      </span>
                    </span>
                    <span>
                      Workspace:{" "}
                      <span className="font-medium text-foreground">
                        {defaultEnvironment ? "ready" : "not created"}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No repository targets configured.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function AdminSettingsWorkspace({
  setup,
  branding,
  onBrandingChange,
  targetApps,
  targetEnvironments,
  session,
}: {
  setup: AdminSetupStatus;
  branding: AdminBranding;
  onBrandingChange: (branding: AdminBranding) => void;
  targetApps: TargetAppRecord[];
  targetEnvironments: TargetEnvironmentRecord[];
  session: {
    capabilities: Capability[];
  };
}) {
  const canManageUsers = session.capabilities.includes("canManageUsers");

  return (
    <div className="grid gap-4">
      <div className="px-5 py-4 md:px-6">
        <SetupStatus setup={setup} />
      </div>
      <div className="border-t border-border/60 px-5 py-4 md:px-6">
        <BrandingSettings branding={branding} onBrandingChange={onBrandingChange} />
      </div>
      <div className="border-t border-border/60 px-5 py-4 md:px-6">
        <EnvironmentInstructions />
      </div>
      <div className="border-t border-border/60 px-5 py-4 md:px-6">
        <RepositorySetup
          targetApps={targetApps}
          targetEnvironments={targetEnvironments}
        />
      </div>
      <div className="border-t border-border/60 px-5 py-4 md:px-6">
        <MembersAndRoles canManageUsers={canManageUsers} />
      </div>
      <div className="border-t border-border/60 px-5 py-4 md:px-6">
        <ReposWorkspace
          targetApps={targetApps}
          targetEnvironments={targetEnvironments}
          activeCount={0}
          closedCount={0}
        />
      </div>
    </div>
  );
}
