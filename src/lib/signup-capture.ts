import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

type SignupBody = {
  company_name?: string;
  company?: string;
  contact_name?: string;
  full_name?: string;
  email?: string;
  role?: "agent" | "broker";
  company_size?: string;
  size?: string;
  state?: "TN" | "VA" | "NC";
  source?: string;
};

type CompanyRecord = {
  id: string;
  product: "eyeonads";
  company_name: string;
  contact_name: string | null;
  email: string;
  role: "agent" | "broker";
  company_size: string;
  state: "TN" | "VA" | "NC";
  plan: "free";
  source: string;
  created_at: string;
};

type EmailEvent = {
  id: string;
  company_id: string;
  sequence: "free-tier-onboarding";
  email_number: 1;
  to_email: string;
  subject: string;
  fired_at: string;
  status: "fired";
  delivery: Record<string, unknown>;
};

export type SupabaseLike = {
  from: (table: "company_signups" | "onboarding_email_events") => {
    insert: (payload: CompanyRecord | EmailEvent) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
};

const localDbPath = path.join(process.cwd(), ".signup-db.json");

function validate(body: SignupBody) {
  const companyName = String(body.company_name || body.company || "").trim();
  const contactName = String(body.contact_name || body.full_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role: "agent" | "broker" = body.role === "broker" ? "broker" : "agent";
  const companySize = String(body.company_size || body.size || "").trim();
  const state: "TN" | "VA" | "NC" = body.state === "VA" || body.state === "NC" ? body.state : "TN";

  if (!companyName) return { error: "company_name is required" };
  if (!email || !email.includes("@")) return { error: "valid email is required" };
  if (!companySize) return { error: "company_size is required" };

  return { companyName, contactName, email, role, companySize, state };
}

async function appendLocal(company: CompanyRecord, emailEvent: EmailEvent) {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return { provider: "local", status: "skipped", reason: "Read-only production runtime" };
  }

  let db: { companies: CompanyRecord[]; onboarding_emails: EmailEvent[] };
  try {
    db = JSON.parse(await fs.readFile(localDbPath, "utf8")) as typeof db;
  } catch {
    db = { companies: [], onboarding_emails: [] };
  }
  db.companies.push(company);
  db.onboarding_emails.push(emailEvent);
  await fs.writeFile(localDbPath, `${JSON.stringify(db, null, 2)}\n`);
  return { provider: "local", status: "appended" };
}

async function persistSupabase(
  company: CompanyRecord,
  emailEvent: EmailEvent,
  getSupabase?: () => Promise<SupabaseLike>
) {
  if (!getSupabase) {
    return { provider: "local", status: "skipped", reason: "No Supabase client supplied" };
  }

  const supabase = await getSupabase();
  const companyResult = await supabase.from("company_signups").insert(company).select("id").single();
  if (companyResult.error) {
    return { provider: "supabase", status: "failed", error: companyResult.error.message };
  }

  const emailResult = await supabase.from("onboarding_email_events").insert(emailEvent).select("id").single();
  if (emailResult.error) {
    return { provider: "supabase", status: "partial", error: emailResult.error.message };
  }

  return { provider: "supabase", status: "persisted", company_id: companyResult.data?.id, email_event_id: emailResult.data?.id };
}

async function sendEmail1(company: CompanyRecord) {
  if (!process.env.SENDGRID_API_KEY) {
    return { provider: "ledger", status: "queued", message: "SENDGRID_API_KEY not configured" };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: company.email }] }],
      from: { email: process.env.ONBOARDING_FROM_EMAIL || "outreach@shieldsenterprises.io" },
      subject: "Welcome to EyeOnAds",
      content: [
        {
          type: "text/html",
          value: `<p>Hi ${company.contact_name || "there"},</p><p>Your free EyeOnAds company workspace for ${company.company_name} is queued.</p>`,
        },
      ],
    }),
  });

  return {
    provider: "sendgrid",
    status: response.ok ? "sent" : "failed",
    http_status: response.status,
    message_id: response.headers.get("x-message-id"),
  };
}

export async function createEyeOnAdsSignup(
  body: SignupBody,
  getSupabase?: () => Promise<SupabaseLike>
) {
  const parsed = validate(body);

  if ("error" in parsed) {
    return { status: 400, body: { error: parsed.error } };
  }

  const now = new Date().toISOString();
  const company: CompanyRecord = {
    id: crypto.randomUUID(),
    product: "eyeonads",
    company_name: parsed.companyName,
    contact_name: parsed.contactName || null,
    email: parsed.email,
    role: parsed.role,
    company_size: parsed.companySize,
    state: parsed.state,
    plan: "free",
    source: body.source || "eyeonads-signup",
    created_at: now,
  };

  const delivery = await sendEmail1(company).catch((error: Error) => ({
    provider: "sendgrid",
    status: "failed",
    error: error.message,
  }));

  const emailEvent: EmailEvent = {
    id: crypto.randomUUID(),
    company_id: company.id,
    sequence: "free-tier-onboarding",
    email_number: 1,
    to_email: company.email,
    subject: "Welcome to EyeOnAds",
    fired_at: now,
    status: "fired",
    delivery,
  };

  const supabasePersistence = await persistSupabase(company, emailEvent, getSupabase);
  const localPersistence = await appendLocal(company, emailEvent).catch((error: Error) => ({
    provider: "local",
    status: "failed",
    error: error.message,
  }));

  return {
    status: 200,
    body: {
      ok: true,
      company_id: company.id,
      onboarding_email_id: emailEvent.id,
      email_1_fired: true,
      email_delivery: delivery,
      persistence: supabasePersistence,
      local_persistence: localPersistence,
    },
  };
}
