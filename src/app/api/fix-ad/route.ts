import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { ComplianceFlag } from "@/lib/supabase/types";

type FixAdRequestBody = {
  ad_copy: string;
  flags: ComplianceFlag[];
  state: string;
};

function ruleBasedFix(ad_copy: string, flags: ComplianceFlag[]): string {
  let fixed = ad_copy;

  const flagRules = flags.map((f) => f.rule.toLowerCase());

  // Remove superlatives
  const superlatives = [
    /\bbest agent\b/gi,
    /\btop realtor\b/gi,
    /\b#1 agent\b/gi,
    /\bnumber one agent\b/gi,
    /\bbest realtor\b/gi,
    /\btop agent\b/gi,
    /\bbest in \w+\b/gi,
  ];
  for (const pattern of superlatives) {
    fixed = fixed.replace(pattern, "experienced agent");
  }

  // Remove discriminatory language
  const discriminatoryPhrases = [
    /\bperfect for families\b/gi,
    /\bgreat for families\b/gi,
    /\bideal for couples\b/gi,
    /\bno children\b/gi,
    /\bno kids\b/gi,
    /\badults only\b/gi,
    /\bchristian neighborhood\b/gi,
    /\bquiet neighborhood\b/gi, // Can be code for exclusion
  ];
  for (const pattern of discriminatoryPhrases) {
    fixed = fixed.replace(pattern, "");
  }

  // Add license placeholder if missing
  const hasLicenseFlag = flagRules.some((r) => r.includes("license"));
  const hasLicenseInCopy = /lic\w*\s*#?\s*\d+/i.test(fixed) || /\[license/i.test(fixed);
  if (hasLicenseFlag && !hasLicenseInCopy) {
    fixed = fixed.trimEnd() + "\n\nLicense #[XXXXX]";
  }

  // Add EHO statement if missing
  const hasEhoFlag = flagRules.some((r) => r.includes("equal housing") || r.includes("eho") || r.includes("fair housing"));
  const hasEhoInCopy = /equal housing/i.test(fixed) || /eho/i.test(fixed);
  if (hasEhoFlag && !hasEhoInCopy) {
    fixed = fixed.trimEnd() + "\n\nEqual Housing Opportunity";
  }

  return fixed.trim();
}

async function fixWithAnthropic(ad_copy: string, flags: ComplianceFlag[], state: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });

    const flagsList = flags
      .map((f) => `- [${f.severity.toUpperCase()}] ${f.rule}: ${f.explanation}`)
      .join("\n");

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `You are a real estate advertising compliance expert. Rewrite the following ad copy to fix all compliance violations found for ${state} state rules and Fair Housing law.

COMPLIANCE FLAGS TO FIX:
${flagsList}

RULES FOR REWRITING:
1. If EHO/Fair Housing flag: Add "Equal Housing Opportunity" at the end
2. If license number flag: Add placeholder "[LICENSE #XXXXX]" at the end
3. Remove superlatives like "best agent", "top realtor", "#1 agent" — replace with neutral alternatives
4. Remove any discriminatory language targeting protected classes
5. Keep the core message and property details intact
6. Do NOT add anything that wasn't in the original unless needed for compliance
7. Return ONLY the rewritten ad copy — no explanations, no preamble, no markdown

ORIGINAL AD COPY:
${ad_copy}`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : null;
    return text;
  } catch (err) {
    console.error("[/api/fix-ad] Anthropic error:", err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FixAdRequestBody;
    const { ad_copy, flags, state } = body;

    if (!ad_copy || !flags || !state) {
      return NextResponse.json(
        { error: "Missing required fields: ad_copy, flags, state" },
        { status: 400 }
      );
    }

    // Try AI-powered fix first, fall back to rule-based
    let rewritten = await fixWithAnthropic(ad_copy, flags, state);
    if (!rewritten) {
      rewritten = ruleBasedFix(ad_copy, flags);
    }

    return NextResponse.json({ rewritten_copy: rewritten });
  } catch (err) {
    console.error("[/api/fix-ad] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
