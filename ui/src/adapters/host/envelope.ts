// Client-side acceptance of `controlsbench.campaign.v1` envelopes (docs/m9-ui-contract.md):
// reject unsupported versions, sequence gaps, broken IDs and hash chains; deduplicate by
// (campaignId, sequence) and treat a duplicate with different bytes as an integrity error.
// Uses WebCrypto so it runs unchanged in the browser and in Node tests.

import type { CampaignEnvelope } from "../../../../src/host/protocol.ts";

export const CAMPAIGN_SCHEMA_VERSION = "controlsbench.campaign.v1";

/** Same canonical form as src/campaign/ledger.ts `canonical` (sorted keys, JSON scalars). */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

export class EnvelopeIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "EnvelopeIntegrityError"; }
}

export class EnvelopeLog {
  readonly campaignId: string;
  readonly #events: CampaignEnvelope[] = [];
  readonly #byId = new Map<string, CampaignEnvelope>();
  #queue: Promise<unknown> = Promise.resolve();
  #failed?: EnvelopeIntegrityError;

  constructor(campaignId: string) { this.campaignId = campaignId; }

  get length(): number { return this.#events.length; }
  get lastSequence(): number { return this.#events.length; }
  get failure(): EnvelopeIntegrityError | undefined { return this.#failed; }
  get(id: string): CampaignEnvelope | undefined { return this.#byId.get(id); }
  get events(): readonly CampaignEnvelope[] { return this.#events; }

  /** Accepts a batch in order; resolves to the newly accepted envelopes (duplicates omitted). */
  accept(batch: readonly CampaignEnvelope[]): Promise<CampaignEnvelope[]> {
    const work = this.#queue.then(() => this.#accept(batch));
    this.#queue = work.catch(() => {});
    return work;
  }

  async #accept(batch: readonly CampaignEnvelope[]): Promise<CampaignEnvelope[]> {
    if (this.#failed) throw this.#failed;
    const accepted: CampaignEnvelope[] = [];
    try {
      for (const event of batch) {
        if (!event || typeof event !== "object") throw new EnvelopeIntegrityError("Incomplete campaign record");
        if (event.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) throw new EnvelopeIntegrityError(`Unsupported campaign schema ${String(event.schemaVersion)}`);
        if (event.campaignId !== this.campaignId) throw new EnvelopeIntegrityError(`Envelope for ${event.campaignId} on ${this.campaignId} stream`);
        if (!Number.isInteger(event.sequence) || event.sequence < 1) throw new EnvelopeIntegrityError("Invalid campaign sequence");
        if (event.sequence <= this.#events.length) {
          const existing = this.#events[event.sequence - 1]!;
          if (canonical(existing) !== canonical(event)) throw new EnvelopeIntegrityError(`Duplicate ${event.id} differs from the accepted record`);
          continue;
        }
        if (event.sequence !== this.#events.length + 1) throw new EnvelopeIntegrityError(`Sequence gap: expected ${this.#events.length + 1}, received ${event.sequence}`);
        if (event.id !== `${this.campaignId}:${event.sequence}`) throw new EnvelopeIntegrityError(`Envelope ID ${event.id} does not match its sequence`);
        if (event.previousHash !== (this.#events.at(-1)?.hash ?? "")) throw new EnvelopeIntegrityError(`Broken hash chain at ${event.id}`);
        if (event.visibility !== "public" && event.visibility !== "truth") throw new EnvelopeIntegrityError("Invalid visibility");
        const { hash, ...body } = event;
        if (await sha256Hex(canonical(body)) !== hash) throw new EnvelopeIntegrityError(`Hash mismatch at ${event.id}`);
        this.#events.push(event); this.#byId.set(event.id, event); accepted.push(event);
      }
    } catch (error) {
      this.#failed = error instanceof EnvelopeIntegrityError ? error : new EnvelopeIntegrityError(String(error));
      // Envelopes accepted earlier in this batch are valid and remain usable.
      if (accepted.length) (this.#failed as EnvelopeIntegrityError & { accepted?: CampaignEnvelope[] }).accepted = accepted;
      throw this.#failed;
    }
    return accepted;
  }
}

/** Parses a JSONL ledger, refusing an incomplete final record (contract: reconcile first). */
export function parseLedgerJsonl(text: string): CampaignEnvelope[] {
  if (text && !text.endsWith("\n")) throw new EnvelopeIntegrityError("Incomplete final ledger record");
  return text.trim() ? text.trim().split(/\r?\n/).map(line => JSON.parse(line) as CampaignEnvelope) : [];
}
