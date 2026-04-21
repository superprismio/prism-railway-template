import { ChangeBoard } from "@/components/admin/change-board"
import { LoginCard } from "@/components/admin/login-card"
import { getAdminBoardData } from "@/lib/admin"

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const errorParam = Array.isArray(resolvedSearchParams.error)
    ? resolvedSearchParams.error[0]
    : resolvedSearchParams.error

  const board = await getAdminBoardData()

  if (!board.ok) {
    const error =
      board.reason === "unauthorized"
        ? "That password did not authenticate against the API."
        : errorParam === "missing-password"
          ? "Enter the shared admin password."
          : board.reason === "error"
            ? "The board could not load the admin API."
            : undefined

    return <LoginCard error={error} />
  }

  return <ChangeBoard data={board.data} />
}
