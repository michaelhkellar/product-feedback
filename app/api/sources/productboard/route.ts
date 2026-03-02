import { NextRequest, NextResponse } from "next/server";
import { getFeatures, getNotes, isProductboardConfigured } from "@/lib/productboard";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-productboard-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") !== "false";

  const [features, notes] = await Promise.all([
    getFeatures(overrideKey, useDemoFallback),
    getNotes(overrideKey, useDemoFallback, 1000),
  ]);

  return NextResponse.json({
    connected: isProductboardConfigured(overrideKey),
    features: features.data,
    featuresIsDemo: features.isDemo,
    notes: notes.data,
    notesIsDemo: notes.isDemo,
  });
}
