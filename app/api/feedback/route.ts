import { listReports, submitReport } from "@/features/feedback/server/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = listReports;
export const POST = submitReport;
