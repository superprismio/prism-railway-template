import { Activity, Bot, GitBranch, KeyRound, LogOut, Rows3, ShieldAlert } from "lucide-react"

import { LoginCard } from "@/components/admin/login-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { getAdminSettingsData, type AdminSetupStatus, type TargetAppRecord, type TargetEnvironmentRecord } from "@/lib/admin"

function statusBadge(ok: boolean, label?: string) {
  return (
    <Badge variant={ok ? "secondary" : "muted"} className={ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : undefined}>
      {ok ? label ?? "Ready" : label ?? "Needs setup"}
    </Badge>
  )
}

function copyBlock(lines: string[]) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-[#1f2330] p-3 text-xs leading-5 text-white">
      {lines.join("\n")}
    </pre>
  )
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
          <CardDescription>Memory API reachability and active space.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {statusBadge(setup.prismMemory.reachable)}
          <p className="text-sm text-muted-foreground">
            Space: <span className="font-medium text-foreground">{setup.prismMemory.space ?? "unknown"}</span>
          </p>
          {setup.prismMemory.error ? <p className="text-sm text-destructive">{setup.prismMemory.error}</p> : null}
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4" />
            Codex Runtime
          </CardTitle>
          <CardDescription>Runtime health and persisted device auth.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {statusBadge(setup.codexRuntime.reachable, setup.codexRuntime.reachable ? "Reachable" : "Unreachable")}
            {statusBadge(setup.codexRuntime.codexAuthConfigured, setup.codexRuntime.codexAuthConfigured ? "Auth configured" : "Auth needed")}
          </div>
          <p className="text-sm text-muted-foreground">
            Home: <span className="font-medium text-foreground">{setup.codexRuntime.codexHome ?? "not reported"}</span>
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
          <CardDescription>App-owned target metadata for Codex workspaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Apps</p>
              <p className="mt-1 text-2xl font-semibold">{setup.targets.targetAppCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-background/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Envs</p>
              <p className="mt-1 text-2xl font-semibold">{setup.targets.targetEnvironmentCount}</p>
            </div>
          </div>
          {statusBadge(setup.targets.targetAppCount > 0 && setup.targets.targetEnvironmentCount > 0)}
        </CardContent>
      </Card>
    </section>
  )
}

function EnvironmentInstructions() {
  const serviceLabel = (name: string) => <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Railway service: {name}</p>

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Discord Optional
          </CardTitle>
          <CardDescription>Set these in Railway only when enabling Discord chat or sync.</CardDescription>
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
          <CardDescription>Discord recording stays disabled until the transcription key is set.</CardDescription>
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
          <CardDescription>Only needed for private repos or branch pushes.</CardDescription>
        </CardHeader>
        <CardContent>
          {serviceLabel("codex-runtime")}
          {copyBlock(['TARGET_REPO_GITHUB_TOKEN=""'])}
        </CardContent>
      </Card>
    </section>
  )
}

function RepositorySetup({ targetApps, targetEnvironments }: { targetApps: TargetAppRecord[]; targetEnvironments: TargetEnvironmentRecord[] }) {
  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle>Repository Target</CardTitle>
          <CardDescription>Create one Codex target. Change request branches start from the target branch.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/admin/target-apps" method="post" className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input name="name" placeholder="DAOhaus Admin" required />
            </div>
            <div className="space-y-2">
              <Label>GitHub Repo URL</Label>
              <Input name="repoUrl" placeholder="https://github.com/HausDAO/daohaus-admin.git" required />
            </div>
            <div className="space-y-2">
              <Label>Target Branch</Label>
              <Input name="defaultBranch" defaultValue="main" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea name="description" placeholder="What this target repo represents." />
            </div>
            <Button type="submit">Create repository target</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-none border-border/60 bg-card/90 shadow-none">
        <CardHeader>
          <CardTitle>Current Targets</CardTitle>
          <CardDescription>Repositories available in the New Change Request form.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {targetApps.length ? (
            targetApps.map((targetApp) => {
              const environments = targetEnvironments.filter((environment) => environment.targetAppId === targetApp.id)
              const defaultEnvironment = environments.find((environment) => environment.isDefaultForAgent) ?? environments[0]
              return (
                <div key={targetApp.id} className="rounded-xl border border-border bg-background/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{targetApp.name}</p>
                      <p className="text-sm text-muted-foreground">{targetApp.repoUrl ?? "No repo URL"}</p>
                    </div>
                    <Badge variant={targetApp.agentEnabled ? "secondary" : "muted"}>
                      {targetApp.agentEnabled ? "Agent on" : "Agent off"}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <span>
                      Target branch: <span className="font-medium text-foreground">{defaultEnvironment?.branch ?? targetApp.defaultBranch ?? "main"}</span>
                    </span>
                    <span>
                      Workspace: <span className="font-medium text-foreground">{defaultEnvironment ? "ready" : "not created"}</span>
                    </span>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No repository targets configured.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const errorParam = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error
  const settings = await getAdminSettingsData()

  if (!settings.ok) {
    const error =
      settings.reason === "unauthorized"
        ? "That password did not authenticate against the API."
        : errorParam === "missing-password"
          ? "Enter the shared admin password."
          : settings.reason === "error"
            ? "Settings could not load the admin API."
            : undefined

    return <LoginCard error={error} />
  }

  return (
    <main className="min-h-screen w-full border-t border-border/60 bg-background text-foreground">
      <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-border/70 bg-muted/40">
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
            <Button asChild variant="outline">
              <a href="/admin">
                <Rows3 className="h-4 w-4" />
                Admin
              </a>
            </Button>
            <form action="/admin/logout" method="post">
              <Button variant="outline" type="submit">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Exit admin</span>
              </Button>
            </form>
          </div>
        </div>
      </div>

      <section className="border-b border-border/60 px-5 py-4 md:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure Prism without moving secrets into the app.
        </p>
      </section>

      <div className="grid gap-4 px-0 py-0">
        <div className="px-5 py-4 md:px-6">
          <SetupStatus setup={settings.data.setup} />
        </div>
        <div className="border-t border-border/60 px-5 py-4 md:px-6">
          <EnvironmentInstructions />
        </div>
        <div className="border-t border-border/60 px-5 py-4 md:px-6">
          <RepositorySetup
            targetApps={settings.data.targetApps}
            targetEnvironments={settings.data.targetEnvironments}
          />
        </div>
      </div>
    </main>
  )
}
