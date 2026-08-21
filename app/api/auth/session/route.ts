import { NextResponse } from "next/server";
import { getAuthStatus } from "@/lib/auth";

export async function GET() {
  const response = NextResponse.json(await getAuthStatus());
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
