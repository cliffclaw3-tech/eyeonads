import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/meta/callback
 *
 * Handles the Meta OAuth callback after user authorizes the app.
 * Exchanges the authorization code for an access token and stores it.
 *
 * NOTE: Token encryption is handled via TOKEN_ENCRYPTION_KEY env var in production.
 * This stub stores the token in plaintext — add AES-256 encryption before launch.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`;

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=meta_oauth_denied`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=meta_no_code`
    );
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = `${appUrl}/api/meta/callback`;

  if (!appId || !appSecret || appId === "your-meta-app-id-here") {
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=meta_not_configured`
    );
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token` +
        `?client_id=${appId}` +
        `&client_secret=${appSecret}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${code}`
    );
    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: { message: string };
    };

    if (!tokenData.access_token) {
      console.error("[meta/callback] Token exchange failed:", tokenData.error);
      return NextResponse.redirect(
        `${appUrl}/dashboard/connect?error=meta_token_failed`
      );
    }

    // Get ad account info
    const meRes = await fetch(
      `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name&access_token=${tokenData.access_token}`
    );
    const meData = (await meRes.json()) as {
      data?: Array<{ id: string; name: string }>;
    };
    const firstAccount = meData.data?.[0];

    // Persist in Supabase
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${appUrl}/login`);
    }

    await supabase.from("ad_accounts").upsert({
      user_id: user.id,
      platform: "meta",
      oauth_token_encrypted: tokenData.access_token, // TODO: encrypt before production
      account_id: firstAccount?.id ?? null,
      account_name: firstAccount?.name ?? null,
      needs_reconnect: false,
    });

    return NextResponse.redirect(`${appUrl}/dashboard/connect?success=meta`);
  } catch (err) {
    console.error("[meta/callback] Error:", err);
    return NextResponse.redirect(
      `${appUrl}/dashboard/connect?error=meta_unexpected`
    );
  }
}
