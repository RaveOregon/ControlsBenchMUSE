import type { BenchConnector, CommitReceipt, ConnectorObservation, RawSignalImage } from "../live/connector.ts";
import type { Clock } from "./clock.ts";
import { systemClock } from "./clock.ts";

export class FakeConnector implements BenchConnector {
  readonly id = "deterministic-fake-connector-v1";
  readonly clock: Clock;
  readonly respond: (image: RawSignalImage) => RawSignalImage;
  image: RawSignalImage = {}; stale = false; simulation = true; bootIdentity = "fixture-boot-1";
  hang = false; closed = false; sequence = 0;
  constructor(respond: (image: RawSignalImage) => RawSignalImage, clock = systemClock) { this.respond = respond; this.clock = clock; }
  async open() { return this.observe(); }
  async resetSession() { this.sequence = 0; this.image = {}; return this.observe(); }
  async commit(image: Readonly<RawSignalImage>): Promise<CommitReceipt> {
    if (this.hang) return new Promise(() => {});
    this.image = structuredClone(image); this.sequence++;
    return { ...await this.observe(), workstationEpoch: "fixture-epoch-1", workstationSequence: String(this.sequence), slot: this.sequence % 2,
      sentAtIso: this.clock.iso(), sentAtMonotonicMs: this.clock.now(), acknowledgedAtIso: this.clock.iso(),
      acknowledgedAtMonotonicMs: this.clock.now(), latencyMs: 0, image: structuredClone(this.image) };
  }
  async observe(): Promise<ConnectorObservation> {
    return { observedAtIso: this.clock.iso(), observedAtMonotonicMs: this.clock.now(), bootIdentity: this.bootIdentity,
      appliedEpoch: "fixture-epoch-1", appliedSequence: String(this.sequence), plcCycle: String(this.sequence),
      plcTimeUs: String(this.sequence * 20_000), outputCaptureCycle: String(this.sequence), outputCaptureTimeUs: String(this.sequence * 20_000),
      connectorStale: this.stale, simulationApplied: this.simulation, values: this.respond(this.image) };
  }
  async close() { this.closed = true; }
}
