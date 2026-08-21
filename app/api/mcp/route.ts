import { handleMcpRequest } from "@/mcp/http";

export async function POST(request: Request): Promise<Response> { return handleMcpRequest(request); }
export async function GET(request: Request): Promise<Response> { return handleMcpRequest(request); }
export async function DELETE(request: Request): Promise<Response> { return handleMcpRequest(request); }
export async function OPTIONS(request: Request): Promise<Response> { return handleMcpRequest(request); }
