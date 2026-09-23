import { NextResponse } from "next/server";

// Intentionally fail closed for the beta candidate. Do not add an authorization
// redirect or accept provider tokens until encrypted token storage and OAuth
// state validation have been independently verified.
export async function GET() {
  return NextResponse.json(
    { error: "Google ad-account connections are unavailable during beta. Use pasted ad copy." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
