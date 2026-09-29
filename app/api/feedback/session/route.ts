import { checkSession, login, logout } from "@/features/feedback/server/handlers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = checkSession;
export const POST = login;
export const DELETE = logout;
