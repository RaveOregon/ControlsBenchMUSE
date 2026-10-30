export type Selection =
  | { type: "event"; id: string }
  | { type: "check"; id: string }
  | { type: "signal"; id: string }
  | { type: "sources" }
  | null;
