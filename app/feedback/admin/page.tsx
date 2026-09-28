import type { Metadata } from "next";
import { FeedbackAdmin } from "@/features/feedback/FeedbackAdmin";
import { FeedbackShell } from "@/features/feedback/FeedbackShell";

export const metadata: Metadata = { title: "제보 관리 | 플래닛", robots: { index: false, follow: false } };
export default function FeedbackAdminPage() { return <FeedbackShell admin><FeedbackAdmin /></FeedbackShell>; }
