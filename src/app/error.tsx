"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /database|ECONNREFUSED|ENOTFOUND|connect/i.test(error.message);
  return (
    <div className="welcome">
      <h1>Something went wrong</h1>
      <p className="muted">
        {db
          ? "Could not reach the database. Please try again in a moment, or check DATABASE_URL on the server."
          : "An unexpected error occurred. Your data is safe — please try again."}
      </p>
      <div className="row">
        <button className="btn btn-primary" onClick={reset}>Try again</button>
        <a className="btn" href="/tools/agency-action-hub">Go to dashboard</a>
      </div>
      {error.digest && <p className="faint small">Reference: {error.digest}</p>}
    </div>
  );
}
