import Link from "next/link";

export default function NotFound() {
  return (
    <div className="welcome">
      <h1>Not found</h1>
      <p className="muted">This email or task doesn’t exist in your workspace (it may have been deleted).</p>
      <div className="row">
        <Link className="btn btn-primary" href="/">Back to dashboard</Link>
      </div>
    </div>
  );
}
