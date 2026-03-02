import { NextResponse } from "next/server";
import { getCalls, isAttentionConfigured } from "@/lib/attention";

export async function GET() {
  const calls = await getCalls();

  return NextResponse.json({
    connected: isAttentionConfigured(),
    calls,
  });
}
