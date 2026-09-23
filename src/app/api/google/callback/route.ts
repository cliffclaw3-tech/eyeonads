import { NextResponse } from "next/server";

// The callback is also closed so a provider redirect cannot become a token path.
export async function GET() {
  return NextResponse.json(
    { error: "Google ad-account connections are unavailable during beta. No account was connected." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
