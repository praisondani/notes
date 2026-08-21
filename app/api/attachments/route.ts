import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { storeObject } from "@/lib/storage";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Files must be 25 MB or smaller" }, { status: 413 });
  }
  const stored = await storeObject(file);
  return NextResponse.json(stored);
}
