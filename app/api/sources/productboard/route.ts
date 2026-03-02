import { NextResponse } from "next/server";
import { getFeatures, getNotes, isProductboardConfigured } from "@/lib/productboard";

export async function GET() {
  const [features, notes] = await Promise.all([getFeatures(), getNotes()]);

  return NextResponse.json({
    connected: isProductboardConfigured(),
    features,
    notes,
  });
}
