import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { adminPasswordCookieName } from "@/lib/admin"

export async function POST() {
  ;(await cookies()).delete(adminPasswordCookieName)
  redirect("/admin")
}
