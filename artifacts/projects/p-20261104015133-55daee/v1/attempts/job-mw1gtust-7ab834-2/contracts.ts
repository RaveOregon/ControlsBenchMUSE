export type RawValue = boolean | number | string | null;

export type SignalDirection = "plc_to_world" | "world_to_plc";

export interface WorldSignal {
  id: string;
  name: string;
  direction: SignalDirection;
  dataType: "BOOL" | "SINT" | "USINT" | "INT" | "UINT" | "DINT" | "UDINT" | "REAL" | "STRING";
  normalValue: RawValue;
  deviceId: string;
  role: string;
  description: string;
}

export interface WorldControlDeclaration {
  id: string;
  description: string;
}

export interface WorldManifest {
  packageVersion: string;
  stateSchemaVersion: string;
  worldId: string;
  name: string;
  tickMs: number;
  signals: WorldSignal[];
  controls: WorldControlDeclaration[];
  inspectableState: string[];
  assumptions: string[];
  faultCapabilities: string[];
  evidenceTypes: string[];
  capabilities: {
    snapshot: boolean;
    migrate: boolean;
    seededRandom: boolean;
  };
}

export interface PlcOutputFrame {
  sequence: number;
  observedAtMs: number;
  values: Record<string, RawValue>;
}

export interface RawInputEffect {
  signalId: string;
  value: RawValue;
  cause: string;
}

export interface WorldTick {
  nowMs: number;
  deltaMs: number;
  tick: number;
}

export interface WorldControl {
  id: string;
  payload?: Record<string, unknown>;
  cause: string;
}

export interface EvidenceEvent {
  type: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface EntitySnapshot {
  id: string;
  type: string;
  state: Record<string, unknown>;
}

export interface ActivityUpdate {
  phase: string;
  message: string;
  progress?: number;
}

export interface ScheduledAction {
  dueAtMs: number;
  control: WorldControl;
}

export interface WorldSnapshot {
  stateSchemaVersion: string;
  worldVersion: string;
  state: unknown;
}

export interface InitializeRequest {
  seed: number;
  worldVersion: string;
}

export interface MigrationRequest {
  fromWorldVersion: string;
  toWorldVersion: string;
}

export interface WorldContext {
  readonly time: {
    readonly nowMs: number;
    readonly deltaMs: number;
    readonly tick: number;
  };
  readonly random: {
    next(): number;
    integer(minInclusive: number, maxInclusive: number): number;
  };
  readonly plc: {
    readRawOutput(signalId: string): RawValue;
    writeRawInput(effect: RawInputEffect): void;
    currentOutputFrame(): PlcOutputFrame;
    currentInputState(): Readonly<Record<string, RawValue>>;
  };
  readonly schedule: {
    at(request: ScheduledAction): string;
    cancel(actionId: string): void;
  };
  readonly entities: {
    publish(snapshot: EntitySnapshot): void;
    remove(entityId: string, reason: string): void;
  };
  readonly evidence: {
    append(event: EvidenceEvent): void;
  };
  readonly status: {
    report(update: ActivityUpdate): void;
  };
}

export interface GeneratedWorldModule {
  readonly manifest: WorldManifest;
  initialize(ctx: WorldContext, request: InitializeRequest): Promise<void>;
  onPlcFrame(ctx: WorldContext, frame: PlcOutputFrame): Promise<void>;
  onControl(ctx: WorldContext, control: WorldControl): Promise<void>;
  tick(ctx: WorldContext, tick: WorldTick): Promise<void>;
  snapshot(ctx: WorldContext): Promise<WorldSnapshot>;
  migrate(ctx: WorldContext, previous: WorldSnapshot, request: MigrationRequest): Promise<WorldSnapshot>;
  dispose(ctx: WorldContext, reason: string): Promise<void>;
}
