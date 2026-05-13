import { handleResponseGet, handleResponsePost } from "@/lib/response-route-handler"
import { requireLocalAdminAccess } from "@/lib/local-admin-api"

export async function GET(request: Request) {
  return handleResponseGet(request, requireLocalAdminAccess)
}

export async function POST(request: Request) {
  return handleResponsePost(request, requireLocalAdminAccess)
}
