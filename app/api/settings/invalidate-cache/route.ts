import { NextResponse } from "next/server";
import { invalidateCache } from "@/lib/data-fetcher";

export async function POST() {
  invalidateCache();
  return NextResponse.json({ ok: true });
}
