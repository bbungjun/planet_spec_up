import { deleteReport, updateReport } from "@/features/feedback/server/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return updateReport(request, (await context.params).id);
}
export async function DELETE(request: Request, context: Context) {
  return deleteReport(request, (await context.params).id);
}
