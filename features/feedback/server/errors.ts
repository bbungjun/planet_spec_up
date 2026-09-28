export class FeedbackError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
  }
}
