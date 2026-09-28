/** Errors that carry a human-readable message safe to show in the UI. */
export class AppError extends Error {
  status: number;
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(`${code}: ${userMessage}`, options?.cause ? { cause: options.cause } : undefined);
    this.status = options?.status ?? 400;
  }
}

export const GmailErrors = {
  expired: () => new AppError("gmail_expired", "Gmail connection expired. Please reconnect your account.", { status: 401 }),
  notConnected: () => new AppError("gmail_not_connected", "Gmail is not connected yet. Click “Connect Gmail” first.", { status: 400 }),
  rateLimited: () => new AppError("gmail_rate_limited", "Gmail is rate-limiting requests right now. Please wait a minute and try again.", { status: 429 }),
  unavailable: (cause?: unknown) => new AppError("gmail_unavailable", "Gmail is temporarily unavailable. Please try again shortly.", { status: 503, cause }),
};

export const AiErrors = {
  notConfigured: () => new AppError("ai_not_configured", "AI is not configured. Add OPENAI_API_KEY to the server environment.", { status: 500 }),
  timeout: () => new AppError("ai_timeout", "The AI took too long to respond. The email was kept and can be re-analysed.", { status: 504 }),
  invalidOutput: (cause?: unknown) => new AppError("ai_invalid_output", "The AI returned an invalid response. The email was kept and can be re-analysed.", { status: 502, cause }),
  upstream: (status: number, cause?: unknown) =>
    new AppError(
      "ai_upstream",
      status === 429 ? "The AI provider is rate-limiting requests. Try again in a minute." : `The AI provider returned an error (${status}).`,
      { status: 502, cause },
    ),
};

export function toUserMessage(err: unknown): string {
  if (err instanceof AppError) return err.userMessage;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|database|relation .* does not exist|password authentication/i.test(msg)) {
    return "Could not reach the database. Please try again, or check DATABASE_URL.";
  }
  return "Something went wrong. Please try again.";
}
