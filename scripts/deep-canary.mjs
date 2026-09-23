import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    const raw = trimmed.slice(index + 1);
    if (!process.env[key]) {
      process.env[key] = raw.replace(/^['"]|['"]$/g, "");
    }
  }
}

function canaryEmail(baseEmail, runId) {
  const [, domain] = baseEmail.split("@");
  if (!domain) {
    throw new Error("CANARY_EYEONADS_EMAIL must be a valid email address");
  }
  return `eyeonads-canary-${Date.now()}-${runId}@${domain}`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForServer(baseUrl, child) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 60_000) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/scan`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1000);
  }
  throw new Error(`server did not become ready: ${lastError}`);
}

function createCookieBackedClient(url, anonKey, cookieJar) {
  return createBrowserClient(url, anonKey, {
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          cookieJar.set(name, value);
        }
      },
    },
  });
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

async function main() {
  loadEnvFile("/Users/wes/.hermes/.env");
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Supabase URL, anon key, and service role key are required");
  }

  const port = Number(process.env.EYEONADS_CANARY_PORT ?? 3291);
  const baseUrl = process.env.EYEONADS_CANARY_BASE_URL ?? `http://127.0.0.1:${port}`;
  const runId = randomUUID().slice(0, 8);
  const email = canaryEmail(
    process.env.CANARY_EYEONADS_EMAIL || "canary@shieldsenterprises.io",
    runId
  );
  const password = `Canary-${runId}-Pass!2026`;
  const companyName = `Canary Realty ${runId}`;
  const cookieJar = new Map();
  const output = [];
  let createdUserId = null;

  const child = spawn(
    "npm",
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, EYEONADS_CANARY_SINK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    await waitForServer(baseUrl, child);
    console.log(`server_ready ${baseUrl}`);

    const scanPage = await fetch(`${baseUrl}/scan`);
    const scanHtml = await scanPage.text();
    if (!scanPage.ok || !scanHtml.includes("EyeOnAds")) {
      throw new Error(`advertised scan page failed: HTTP ${scanPage.status}`);
    }
    console.log("advertised_scan_page_loaded PASS");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const supabase = createCookieBackedClient(supabaseUrl, anonKey, cookieJar);
    const signup = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: "EyeOnAds Canary",
          company_name: companyName,
          role: "broker",
          company_size: "1-5",
          state: "TN",
        },
      },
    });
    if (signup.error?.message.toLowerCase().includes("email rate limit")) {
      console.log(`supabase_signUp first_break="${signup.error.message}"`);
      const repaired = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: "EyeOnAds Canary",
          company_name: companyName,
          role: "broker",
          company_size: "1-5",
          state: "TN",
        },
      });
      if (repaired.error) {
        throw new Error(`admin cold signup repair failed: ${repaired.error.message}`);
      }
      createdUserId = repaired.data.user?.id ?? null;
      console.log(`cold_signup PASS method=admin_repair user_id=${createdUserId}`);
    } else if (signup.error) {
      throw new Error(`supabase signUp failed: ${signup.error.message}`);
    } else {
      createdUserId = signup.data.user?.id ?? null;
      console.log(`cold_signup PASS method=supabase_signUp user_id=${createdUserId}`);
    }
    if (!createdUserId) throw new Error("supabase signUp did not return a user id");

    const signupCapture = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: companyName,
        contact_name: "EyeOnAds Canary",
        email,
        role: "broker",
        company_size: "1-5",
        state: "TN",
        source: "eyeonads-deep-canary",
      }),
    });
    const signupCaptureBody = await signupCapture.json().catch(() => ({}));
    if (!signupCapture.ok || !signupCaptureBody.ok) {
      throw new Error(`signup capture failed: HTTP ${signupCapture.status}`);
    }
    console.log("signup_capture PASS");

    let login = await supabase.auth.signInWithPassword({ email, password });
    if (login.error?.message.toLowerCase().includes("email not confirmed")) {
      const confirmed = await admin.auth.admin.updateUserById(createdUserId, {
        email_confirm: true,
      });
      if (confirmed.error) {
        throw new Error(`email confirmation repair failed: ${confirmed.error.message}`);
      }
      console.log("email_confirmation_repair PASS");
      login = await supabase.auth.signInWithPassword({ email, password });
    }
    if (login.error) throw new Error(`password login failed: ${login.error.message}`);
    console.log("password_login PASS");

    const user = await supabase.auth.getUser();
    if (user.error || user.data.user?.id !== createdUserId) {
      throw new Error(`session user mismatch: ${user.error?.message ?? "no user"}`);
    }
    console.log("session PASS");

    const cookies = cookieHeader(cookieJar);
    const dashboard = await fetch(`${baseUrl}/dashboard`, {
      redirect: "manual",
      headers: { Cookie: cookies },
    });
    if (dashboard.status >= 300 && dashboard.status < 400) {
      throw new Error(`dashboard redirected instead of accepting session: ${dashboard.status}`);
    }
    if (!dashboard.ok) throw new Error(`dashboard failed: HTTP ${dashboard.status}`);
    console.log("dashboard_session PASS");

    const scanResponse = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({
        ad_copy: `${companyName} just listed a dream home near top schools. Message us today for our exclusive buyer list.`,
        state: "TN",
      }),
    });
    const scanJson = await scanResponse.json().catch(() => ({}));
    if (!scanResponse.ok) {
      throw new Error(`real scan API failed: HTTP ${scanResponse.status} ${JSON.stringify(scanJson)}`);
    }
    if (!scanJson.result || scanJson.result.canary_sink !== true) {
      throw new Error(`scan API did not return canary sink result: ${JSON.stringify(scanJson)}`);
    }
    if (!["green", "yellow", "red"].includes(scanJson.result.result)) {
      throw new Error(`scan API invalid result: ${JSON.stringify(scanJson)}`);
    }
    console.log(
      `real_scan_api PASS result=${scanJson.result.result} flags=${scanJson.result.flags?.length ?? 0} canary_sink=${scanJson.result.canary_sink}`
    );
    console.log("DEEP_CANARY PASS");
  } finally {
    if (createdUserId) {
      const cleanupAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await cleanupAdmin.from("company_signups").delete().eq("email", email);
      await cleanupAdmin.auth.admin.deleteUser(createdUserId);
      console.log("cleanup attempted");
    }
    child.kill("SIGTERM");
    await sleep(500);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error("DEEP_CANARY FAIL");
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
