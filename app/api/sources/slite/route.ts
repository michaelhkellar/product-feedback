import { NextRequest, NextResponse } from "next/server";
import { getSliteNotes, isSliteConfigured } from "@/lib/slite";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-slite-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") === "true";

  const configured = isSliteConfigured(overrideKey);
  const notes = await getSliteNotes(overrideKey, useDemoFallback);
  if (!configured && !notes.isDemo) {
    return NextResponse.json({ connected: false, notes: [], notesIsDemo: false });
  }

  return NextResponse.json({
    connected: configured,
    notes: notes.data,
    notesIsDemo: notes.isDemo,
  });
}
