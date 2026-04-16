import { NextRequest, NextResponse } from "next/server";
import { getLinearTeams } from "@/lib/linear";

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-linear-key") || process.env.LINEAR_API_KEY;
  if (!key) {
    return NextResponse.json({ teams: [] });
  }

  try {
    const teams = await getLinearTeams(key);
    return NextResponse.json({ teams });
  } catch (error) {
    console.error("Failed to fetch Linear teams:", error);
    return NextResponse.json({ teams: [] });
  }
}
