import { KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getActiveUserInviteByToken } from "@/lib/app-core"

export default async function ClaimPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const token = Array.isArray(resolvedSearchParams.token)
    ? resolvedSearchParams.token[0]
    : resolvedSearchParams.token
  const error = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error
  const invite = token ? getActiveUserInviteByToken(token) : null

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-16">
      <Card className="w-full border-border/60 bg-card/95 backdrop-blur">
        <CardHeader className="space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle className="text-2xl">
            {invite?.kind === "reset" ? "Reset Password" : "Claim Access"}
          </CardTitle>
          <CardDescription>
            {invite
              ? `Set a password for ${invite.user.email ?? invite.user.displayName ?? "this account"}.`
              : "This invite link is invalid, expired, or already used."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invite && token ? (
            <form action="/claim/submit" method="post" className="space-y-4">
              <input type="hidden" name="token" value={token} />
              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  defaultValue={invite.user.displayName ?? ""}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input id="password" name="password" type="password" minLength={10} required />
              </div>
              {error ? (
                <p className="text-sm text-destructive">
                  {error === "short-password"
                    ? "Password must be at least 10 characters."
                    : "This invite could not be claimed."}
                </p>
              ) : null}
              <Button className="w-full" type="submit">
                Continue
              </Button>
            </form>
          ) : (
            <Button asChild className="w-full" variant="outline">
              <a href="/admin">Return to sign in</a>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
