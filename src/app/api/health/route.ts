import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

export async function GET() {
  let appVersion = "unknown";
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    appVersion = pkg.version ?? "unknown";
  } catch {
    // ignore parse/file errors
  }

  const startedAt = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString();
  return NextResponse.json({
    ok: true,
    appVersion,
    startedAt,
    checkedAt: new Date().toISOString(),
  });
}
