import { redirect } from "next/navigation";
import { getCurrent, type Current } from "./current";

/** For app pages: resolve the workspace or send the visitor to the welcome screen. */
export async function pageContext(): Promise<Current> {
  const c = await getCurrent();
  if (!c) redirect("/");
  return c;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}
