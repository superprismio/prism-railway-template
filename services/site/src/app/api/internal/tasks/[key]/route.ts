import { NextResponse } from "next/server"

import { deleteCustomTaskByKey } from "@/lib/app-core"
import { requireServiceAccess } from "@/lib/internal-service"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const access = await requireServiceAccess()
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status })
  }

  const { key } = await params
  try {
    const task = deleteCustomTaskByKey(decodeURIComponent(key))
    if (!task) {
      return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 })
    }
    return NextResponse.json({ ok: true, task })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete task"
    const status = message === "TASK_DELETE_SYSTEM_DEFAULT" ? 409 : 400
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
