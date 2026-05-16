import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/google/callback
 *
 * Handles the Google OAuth callback. Exchanges code for tokens and stores them.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`;

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=google_oauth_denied`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=google_no_code`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${appUrl}/api/google/callback`;

  if (!clientId || !clientSecret || clientId === "your-google-client-id-here") {
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=google_not_configured`
    );
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };

    if (!tokenData.access_token) {
      console.error("[google/callback] Token exchange failed:", tokenData.error);
      return NextResponse.redirect(
        `${appUrl}/dashboard/connect?error=google_token_failed`
      );
    }

    // Get user email from Google
    const userRes = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const userData = (await userRes.json()) as { email?: string; id?: string };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${appUrl}/login`);
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    await supabase.from("ad_accounts").upsert({
      user_id: user.id,
      platform: "google",
      oauth_token_encrypted: tokenData.access_token, // TODO: encrypt before production
      refresh_token_encrypted: tokenData.refresh_token ?? null,
      account_id: userData.id ?? null,
      account_name: userData.email ?? null,
      token_expires_at: expiresAt,
      needs_reconnect: false,
    });

    return NextResponse.redirect(`${appUrl}/dashboard/connect?success=google`);
  } catch (err) {
    console.error("[google/callback] Error:", err);
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=google_unexpected`
    );
  }
}
