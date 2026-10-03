import Anthropic from "@anthropic-ai/sdk";

export interface IdentifiedCd {
  artist: string;
  title: string;
  year: number | null;
  confidence: number; // 0..1
  collectible: boolean;
  why: string | null;
}

export interface IdentifyResult {
  cds: IdentifiedCd[];
  unreadable: number;
}

const PROMPT = `You are helping a used-CD reseller. The photo shows CDs: spines, front covers, or a stack/box.

Identify every CD whose artist and title you can actually read.
- Use the exact artist and title as printed. Do not "correct" them to a different release.
- Compilations: artist is "Various Artists".
- year: only if printed on the item or you are certain of it; otherwise null.
- confidence: 0 to 1, how sure you are of artist AND title together.
- collectible: true only for releases known to sell above typical used-CD prices (out of print, import, limited edition, box set, promo, sought-after label pressing). Otherwise false.
- why: when collectible is true, a 2-6 word reason (e.g. "out-of-print Japanese import"); otherwise null.
- Skip CDs you cannot read. Count them in "unreadable".
- List each physical CD once.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cds", "unreadable"],
  properties: {
    cds: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["artist", "title", "year", "confidence", "collectible", "why"],
        properties: {
          artist: { type: "string" },
          title: { type: "string" },
          year: { anyOf: [{ type: "integer" }, { type: "null" }] },
          confidence: { type: "number" },
          collectible: { type: "boolean" },
          why: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    unreadable: { type: "integer" },
  },
} as const;

const MAX_STR = 200;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MAX_STR) : "";
}

/** Defensive validation: the schema is enforced server-side, but never trust it blindly. */
export function parseIdentifyJson(text: string): IdentifyResult {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Model returned no JSON");
    raw = JSON.parse(m[0]);
  }
  const list: any[] = Array.isArray(raw?.cds) ? raw.cds : [];
  const thisYear = new Date().getFullYear();
  const cds: IdentifiedCd[] = [];
  for (const c of list) {
    const artist = str(c?.artist);
    const title = str(c?.title);
    if (!artist || !title) continue;
    const yearN = Number(c?.year);
    const year = Number.isInteger(yearN) && yearN >= 1900 && yearN <= thisYear ? yearN : null;
    const confN = Number(c?.confidence);
    const confidence = Number.isFinite(confN) ? Math.min(1, Math.max(0, confN)) : 0.5;
    const collectible = c?.collectible === true;
    const why = collectible ? str(c?.why).split(/\s+/).filter(Boolean).slice(0, 6).join(" ") || null : null;
    cds.push({ artist, title, year, confidence, collectible, why });
  }
  const unreadableN = Number(raw?.unreadable);
  return { cds, unreadable: Number.isInteger(unreadableN) && unreadableN > 0 ? unreadableN : 0 };
}

export class Identifier {
  private client: Anthropic;
  private model: string;
  private effort: "low" | "medium" | "high";

  constructor(opts: { apiKey: string; model: string; effort: "low" | "medium" | "high" }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 90_000 });
    this.model = opts.model;
    this.effort = opts.effort;
  }

  async identify(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<IdentifyResult> {
    const params: any = {
      model: this.model,
      max_tokens: 8000,
      // Server-side refusal fallback: a declined request is re-run on
      // Anthropic's recommended fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.effort, format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    };
    const response: any = await this.client.beta.messages.create(params);
    if (response.stop_reason === "refusal") throw new Error("Identification declined for this photo");
    if (response.stop_reason === "max_tokens") throw new Error("Too many CDs in one photo; try a closer shot");
    const text = (response.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    return parseIdentifyJson(text);
  }
}
