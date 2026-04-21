import { NextResponse } from "next/server"

import { getAdminBoardData } from "@/lib/admin"

export async function GET() {
  const board = await getAdminBoardData()

  if (!board.ok) {
    const status = board.reason === "unauthorized" ? 401 : board.reason === "missing-password" ? 401 : 500
    return NextResponse.json(board, { status })
  }

  return NextResponse.json(board)
}
