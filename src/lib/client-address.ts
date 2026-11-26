export function clientAddress(request: Request): string | null {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return null;
  const address = request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return address ? address.slice(0, 64) : null;
}
