import { requireServiceAccess } from "@/lib/internal-service"
import { handleResponseGet, handleResponsePost } from "@/lib/response-route-handler"

export async function GET(request: Request) {
  return handleResponseGet(request, requireServiceAccess)
}

export async function POST(request: Request) {
  return handleResponsePost(request, requireServiceAccess)
}
