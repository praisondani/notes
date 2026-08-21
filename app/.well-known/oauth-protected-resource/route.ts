import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/lib/mcp-oauth";

export function GET(request: Request): Response {
  const response = NextResponse.json(protectedResourceMetadata(new URL(request.url).origin));
  response.headers.set("Cache-Control", "public, max-age=300");
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
