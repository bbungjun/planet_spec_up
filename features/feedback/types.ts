export const FEEDBACK_CATEGORIES = {
  recognition: "사진 인식", calculation: "계산 결과", storage: "저장·불러오기",
  comparison: "후보 비교", display: "화면·사용성", other: "기타",
} as const;
export const FEEDBACK_STATUSES = {
  received: "접수", investigating: "확인 중", resolved: "수정 완료", closed: "종료",
} as const;
export type FeedbackCategory = keyof typeof FEEDBACK_CATEGORIES;
export type FeedbackStatus = keyof typeof FEEDBACK_STATUSES;
export type FeedbackInput = {
  id: string;
  category: FeedbackCategory;
  title: string;
  description: string;
  environment: string;
};
export type FeedbackReport = FeedbackInput & {
  sequence: number;
  status: FeedbackStatus;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
};
export type FeedbackList = { reports: FeedbackReport[]; nextCursor: number | null };
