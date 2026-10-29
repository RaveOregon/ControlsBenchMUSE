# Architecture and decision record

> Historical scaffold sketch. Its assumptions are unapproved; see [the current source audit and design proposal](design-review.md) for the user's confirmed direction and the actual status of reusable components.

## Product promise

Muse constructs a live process model and an investigation plan from the engineer's specification. ControlsBench executes that model continuously against actual control logic through a replaceable connector, observes the control response, adapts experiments, and retains evidence.

## Boundary chosen for the first slice

```text
Functional spec
      |
      v
Muse model compiler ----> declarative process model + experiment catalog
                                   |
                                   v
                           deterministic runtime
                         /                       \
              simulated field inputs       observed outputs
                         \                       /
                          connector contract
                                  |
                       PLC emulator (now)
                       OPC UA / CODESYS (next)
```

The model reasons at experiment boundaries and after meaningful observations. The deterministic runtime owns the 100 ms simulation cadence. This avoids making process continuity depend on inference latency while still giving Muse ownership of the machine behavior, relationships, fault hypotheses, and experiment selection.

## Portable connector contract

A connector must expose:

1. `writeInputs(values)` — apply logical simulated inputs to an interceptor namespace.
2. `scan(now)` — development-only hook; a real connector may no-op because the PLC scans independently.
3. `readOutputs()` — return observed outputs and diagnostic values.
4. `describe()` — advertise identity, transport, and whether it is real or emulated.

Logical names are kept outside vendor tag paths. A future OPC UA mapping file will bind logical signal IDs to node IDs.

## Declarative model contract

The initial model describes process timing, signal IDs, fault experiments, and evidence expectations. It intentionally does not permit arbitrary generated code. That makes model output inspectable and safely executable. More process primitives can be added without changing connectors.

## Immediate next vertical slice

1. Build a CODESYS Control Win conveyor application with a simulation-mode interceptor and the same logical signals.
2. Implement the OPC UA connector and a mapping file.
3. Run this exact plant/investigator against that runtime.
4. Add a single WebVisu screen and capture one alarm/reset evidence frame.

## Decisions still owned by the user

- Competition track and repository license.
- Whether Control Win or Raspberry Pi is the final physical demo target.
- Whether HMI vision makes the first submission or follows the OPC UA proof.
