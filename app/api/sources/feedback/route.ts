import { NextRequest, NextResponse } from "next/server";
import { getNotes, isProductboardConfigured } from "@/lib/productboard";
import { DEMO_FEEDBACK } from "@/lib/demo-data";

export async function GET(req: NextRequest) {
  const pbKey = req.headers.get("x-productboard-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") !== "false";

  if (!isProductboardConfigured(pbKey)) {
    if (useDemoFallback) {
      return NextResponse.json({ feedback: DEMO_FEEDBACK, isDemo: true });
    }
    return NextResponse.json({ feedback: [], isDemo: false });
  }

  try {
    const notes = await getNotes(pbKey, useDemoFallback, 500);
    return NextResponse.json({ feedback: notes.data, isDemo: notes.isDemo });
  } catch {
    return NextResponse.json({ feedback: [], isDemo: false });
  }
}
