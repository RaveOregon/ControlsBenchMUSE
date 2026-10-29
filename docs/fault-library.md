# ControlsBench Fault Library

Updated 2026-10-29. This is the design foundation for reusable fault mechanisms, known-fault PLC-response checks, and blind Muse diagnosis. It is not a claim that every PLC must respond identically to every condition.

## Purpose

The fault library gives Muse a vocabulary of common failure mechanisms without reducing campaigns to a fixed script. Muse can select, parameterize, compose, and extend these primitives against the actual specification, device model, and observed PLC behavior.

Faults come from four sources:

1. **Specification-declared:** named in the functional specification, I/O requirements, alarm matrix, or engineer tests.
2. **Core library:** reusable controls, raw-I/O, device, transport, actuator, HMI, and alarm mechanisms.
3. **Muse-generated:** novel conditions or combinations inferred from geometry, signal types, timing, requirements, and campaign observations.
4. **Learned:** reviewed fault patterns retained from prior campaigns or domain adapters.

The existence of a fault template does not define the required PLC response. Expected behavior belongs to the specification/test oracle. If no response is specified, ControlsBench records the result as exploratory rather than inventing a pass criterion.

## Known and Blind Modes

Both modes are first-class:

- **Known fault:** Muse knows the exact fault or fault class and tests whether the PLC, HMI, alarm system, and recovery behavior meet the specification.
- **Blind diagnosis:** the injector/runtime commits the exact fault to a hidden ground-truth ledger, while a fresh diagnosing Muse context receives only the permitted raw I/O, HMI, connector, and campaign evidence.

Known mode may disclose the exact instance, disclose only the class, or hide target/parameters. Blind mode withholds fault names, parameters, descriptive generated source, hidden overlays, and prior model context that would reveal the answer. If the same Muse context selected or authored the fault, its diagnosis is not genuinely blind.

The diagnosis is sealed before truth is revealed and scored. Ground truth is never rewritten after observing the outcome.

## Fault Template Contract

The exact implementation schema remains to be coded, but every reusable template needs the following concepts:

```ts
type FaultTemplate = {
  id: string;
  version: string;
  title: string;

  origin: {
    kind: "spec" | "core_library" | "muse_generated" | "learned";
    references?: string[];
    createdBy?: string;
  };

  category:
    | "discrete_io"
    | "analog_io"
    | "encoder_counter"
    | "actuator_feedback"
    | "transport"
    | "device_protocol"
    | "physical_process"
    | "hmi_command"
    | "hmi_status"
    | "alarm_presentation"
    | "hmi_runtime"
    | "compound";

  injectionLayer:
    | "physical_truth"
    | "transducer_device"
    | "raw_plc_input"
    | "connector_transport"
    | "physical_output_sink"
    | "hmi_input"
    | "hmi_presentation";

  applicability: {
    requiredCapabilities: string[];
    targetSelectorSchema: object;
    preconditions?: object[];
    incompatibleWith?: string[];
  };

  parameterSchema: object;
  activationSchema: object;
  durationSchema: object;
  recoverySchema: object;

  compositionPolicy: {
    priority?: number;
    interaction: "add" | "override" | "transform" | "reject_conflict";
  };

  knownDisclosure: "exact" | "class_only" | "target_only";
  blindEligible: boolean;
  evidenceRequirements: string[];
  cleanupRequirements: string[];
  validationRules: string[];
  implementationKind:
    | "signal_transform"
    | "generated_behavior"
    | "transport_fault"
    | "hmi_fault";
};
```

A concrete instance resolves the template's target, parameters, seed, activation, duration, recovery, and disclosure mode. Before arming, ControlsBench records a hash/commitment of the hidden resolved truth. Lifecycle states are `draft`, `validated`, `armed`, `active`, `recovering`, `cleared`, and `sealed`.

## Core Raw-I/O and Device Families

### Discrete inputs

- stuck false or stuck true;
- intermittent dropout;
- chatter/contact bounce around an edge;
- pulse shorter than the module/application filter;
- delayed edge;
- inverted logic;
- swapped/cross-wired channels;
- power/common/open-wire conditions represented according to the selected module/device model;
- contradictory combinations that are physically impossible or intentionally suspicious.

Rockwell documents input chatter, input filtering, open-wire behavior, and diagnostic cases in which wiring failures appear merely as an inactive or active input rather than a diagnosed fault. Beckhoff documents pulse suppression and signal-extension/filter behavior. These support raw edge, bounce, short-pulse, open/short, and mapping templates. [Rockwell ControlLogix Digital I/O](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/1756-um058_-en-p.pdf), [Rockwell FLEX diagnostic modules](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/1794-um061_-en-p.pdf), [Beckhoff input filters](https://infosys.beckhoff.com/content/1033/ep8601-0022/14998941067.html?id=1392621624319110946)

### Analog and numeric inputs

- open wire/broken loop and device/module sentinel values;
- under-range, over-range, saturation, and clipping;
- bias, drift, gain, or scaling error;
- wrong signedness, byte order, decimal placement, or unit assumption;
- noise, spikes, oscillation, and filter-response tests;
- frozen/stale but plausible value;
- bad/uncertain quality with a plausible held value;
- good quality paired with an impossible value;
- quantization/resolution loss;
- supply/common-mode/reference-junction/device-status failures where the selected module exposes them.

Siemens documents analog diagnostics including wire break, overflow, underflow, no supply, common-mode error, short circuit, and raw sentinel values such as `7FFFh`/`8000h` depending on module configuration. The exact raw encoding must come from the configured module profile rather than a universal library constant. [Siemens analog value processing](https://support.industry.siemens.com/cs/attachments/67989094/s71500_analog_value_processing_manual_en-US_en-US.pdf?download=true), [Siemens ET 200eco PN](https://support.industry.siemens.com/dl/files/018/29999018/att_892386/v1/et200eco_pn_operating_instructions_en-US_en-US.pdf)

### Encoders and counters

- missing pulses or zero frequency while physical motion continues;
- extra/double pulses;
- pulse jitter;
- A/B phase swap, reversed direction, or polarity inversion;
- count reset or lost reference;
- wrap/overflow at numeric boundaries;
- excessive frequency or invalid quadrature;
- mechanical slip between physical motion and count movement;
- frozen count, stale quality, or delayed count delivery.

The world owns physical motion; the device model generates the raw pulse/count behavior. Rockwell and Beckhoff documentation supports missing-pulse/zero-frequency, direction, count-limit, quality, and encoder-diagnostic tests. [Rockwell FLEX 5000 high-speed counters](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/5094-um003_-en-p.pdf), [Rockwell high-speed counter troubleshooting](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/1746-um002_-en-p.pdf), [Beckhoff encoder diagnostics](https://infosys.beckhoff.com/content/1033/tcdiagnostics/513136907.html)

### Outputs, actuators, and feedback

- application command produces no physical effect;
- delayed, slow, partial, reversed, oscillating, or overshooting travel;
- actuator jam or stuck position;
- command ignored or physical sink suppressed;
- open wire/no load;
- short, overload, fuse, or output-power failure;
- feedback stuck independently of physical state;
- command/feedback mismatch;
- both end limits true, neither limit reached before timeout, or otherwise contradictory feedback;
- output command continues after the condition should have cleared.

The trace must distinguish the PLC's raw command, the physical output sink, simulated physical truth, and returned feedback. Vendor manuals document no-load/open-wire, short/overload, point-level output verification, and actuator-feedback monitoring. [Siemens ET 200SP digital outputs](https://support.industry.siemens.com/cs/attachments/59753588/et200sp_dq_8x24vdc_0_5a_st_manual_en-US_en-US.pdf), [Rockwell point-level output faults](https://www.rockwellautomation.com/en-id/docs/studio-5000-logix-designer/37-00/contents-ditamap/module-information/1756-controllogix-i-o-modules/point-level-fault-reporting.html), [Beckhoff actuator feedback](https://infosys.beckhoff.com/content/1033/tf8040_tc3_buildingautomation/13550521483.html)

### Connector and device communication

- frame/update loss;
- duplicate or repeated sequence;
- delayed delivery and jitter;
- reordering where the transport can exhibit or the fault injector intentionally simulates it;
- link silence/stale heartbeat;
- bad/uncertain quality;
- disconnect/reconnect;
- recovery with intermediate events lost;
- protocol status/value disagreement;
- lag that crosses a test timing threshold.

The workstation-frame/PLC-echo contract provides direct evidence for sequence loss, repeat, lag, and staleness. Vendor cycle counters and communication-fault behaviors demonstrate these as real diagnostic concerns. [Beckhoff CycleCounter monitoring](https://infosys.beckhoff.com/content/1033/el2262/13467982603.html), [Rockwell communication-fault counter state](https://www.rockwellautomation.com/en-ca/docs/technical/i-o/current/5034-pointmax/_online/5034-um006-ditamap/5034-encoder-interface-module/hsc-mode/configure-counter-state-in-fault-mode.html)

## Core HMI and Alarm Families

HMI faults require HMI interaction or timestamped visual observation plus correlation with the PLC trace. If those capabilities are unavailable, mark the check `not run` rather than infer screen behavior from tags.

### Commands and controls

- button press produces no command;
- wrong command/tag mapping;
- delayed or duplicate command;
- momentary control sticks;
- control enabled in the wrong mode or authority state;
- HMI appears to accept a command the PLC rejected;
- command executes but no completion/failure feedback appears;
- acknowledgement/reset affects the wrong item or does nothing.

HSE guidance states that operators should be clearly informed of the result of an action and informed when a delay prevents immediate feedback. [HSE control-room design](https://www.hse.gov.uk/comah/sragtech/techmeascontrol.htm)

### Machine status and indication

- status absent, wrong, inverted, delayed, or frozen;
- last known value appears current after connection/quality loss;
- bad/uncertain quality is not indicated;
- running/stopped/faulted display disagrees with PLC outputs;
- mode, ownership, or local/remote authority is incorrect;
- engineering units, range, scale, sign, or decimal place is wrong;
- overview and detail screens disagree;
- label/text is misleading or state is distinguished by color alone;
- required information cannot be reached through navigation;
- screen freezes while several source values continue changing.

HSE calls for understandable action feedback, visible deviations, consistent presentation, non-color-only alarm coding, and readable interfaces during high activity. Siemens publishes explicit quality states such as last usable, no usable, substitute, range violation, and sensor failure, supporting stale/quality presentation tests. [HSE control-room design](https://www.hse.gov.uk/comah/sragtech/techmeascontrol.htm), [Siemens Industrial Edge data quality](https://developer.siemens.com/industrial-edge/api/databus/overview.html)

### Alarm presentation and lifecycle

- required alarm missing or late;
- alarm occurs without its condition;
- alarm clears while the condition remains or fails to clear after correction;
- acknowledgement does nothing or targets the wrong alarm;
- wrong priority/class, unclear cause, or no useful response guidance;
- duplicate/cascading alarm, chatter, fleeting alarm, or standing stale alarm;
- alarm flood masks the important alarm;
- incorrect shelving/suppression for the operating mode;
- history/log omits, duplicates, or misorders events;
- communication recovery loses alarms;
- audible/visual presentation disagrees with priority;
- bad-quality alarm appears valid.

HSE says alarms should be useful, relevant, actionable, timely, consistently presented, and protected from masking/flooding. ISA's public ISA-18 material covers alarm lifecycle, prioritization, standing/stale/repeat alarms, response time, and discrete/batch operation. [HSE alarm management](https://www.hse.gov.uk/humanfactors/topics/alarm-management.htm), [HSE control systems](https://www.hse.gov.uk/comah/sragtech/techmeascontsyst.htm), [ISA-18 series](https://www.isa.org/standards-and-publications/isa-standards/isa-18-series-of-standards)

### HMI runtime and communication

- blank or frozen display;
- touch/control region nonresponsive;
- excessive screen or command latency;
- tag, alarm, event, or communication service failure;
- controller unavailable;
- reconnection does not restore current state;
- stale/bad data retained without quality indication;
- memory/configuration load prevents variables or alarms from appearing;
- clock mismatch corrupts event ordering;
- trends/history lost through interruption.

Schneider and Rockwell document blank/nonresponsive/slow HMI behavior, unavailable controllers, bad-quality/missing alarm data, and service/configuration failures. [Schneider HMI troubleshooting](https://product-help.schneider-electric.com/Machine%20Expert/V2.0/en/SCUhw/SCUhw/HMI_Troubleshooting/HMI_Troubleshooting-2.htm), [Rockwell View Designer](https://literature.rockwellautomation.com/idc/groups/literature/documents/um/9324-um001_-en-d.pdf)

## Composition and Muse-Created Faults

The library should favor primitive mechanisms and explicit compositions:

```text
encoder.missing_pulse
  + connector.jitter
  + hmi.alarm_missing
```

rather than a catalog of fixed scenarios. A compound instance defines precedence and whether each effect adds, overrides, transforms, or conflicts with another effect.

Muse-created faults must pass validation before arming:

- raw types and targets exist;
- required connector/HMI capabilities are present;
- physical behavior is plausible, or intentional impossibility is labeled;
- injection and cleanup are observable and reversible;
- evidence hooks exist;
- composition precedence is explicit;
- cost/time limits fit the campaign budget;
- hidden truth cannot leak into a blind investigator view.

## Truth and Evidence Lanes

Keep these independently event-sourced:

1. specification expectation;
2. physical world truth;
3. fault intervention truth;
4. connector/transport truth;
5. PLC observations;
6. HMI evidence;
7. Muse hypothesis and requested experiment;
8. adjudicated result.

The world model's expected state is not proof of PLC behavior. A requested injection is not proof that it reached the PLC. An HMI screen is not proof of raw PLC state. Each conclusion cites the relevant lane and synchronization point.

## Scoring

Known-fault checks score requirement response, detection/alarm latency, sequence/interlock behavior, presentation, reset/recovery, and unsupported or missed transitions.

Blind diagnosis scores fault category/target, onset and parameter accuracy, causal explanation with trace citations, usefulness of follow-up experiments, time/cost efficiency, false positives, and appropriate abstention when evidence is insufficient.

Campaign scoring includes requirement and fault-class coverage, valid novel faults, evidence completeness, diagnosis improvement after follow-ups, and bench/model cost.

## First-Proof Subset

The first conveyor campaign should implement only enough primitives to prove the architecture:

- discrete sensor bounce and stuck false/true;
- contradictory divert limits;
- motor command without running feedback;
- divert command with delayed/no physical motion;
- one connector stale/sequence-lag condition if inexpensive;
- known-fault mode and one genuinely blind diagnostic run;
- if HMI capture is ready: button produces no result, displayed status disagrees with trace, or required alarm is missing/late.

Muse remains free to generate an additional valid fault or composition from the accepted specification and observed behavior. The core subset is a capability seed, not the campaign script.

## Common Pitfalls

- leaking blind truth through names, generated source, prior conversation, UI overlays, or descriptive identifiers;
- calling a fault selected by the same Muse context "blind";
- conflating requested injection with applied raw signal;
- treating world truth as PLC evidence;
- scoring a diagnosis across an unacknowledged evidence gap;
- failing to align HMI video, interaction, connector frames, and PLC observations;
- composing conflicting effects without precedence;
- omitting resolved parameters and random seeds;
- allowing a hot reload to silently change committed ground truth;
- testing an HMI capability that is not connected and labeling it passed;
- rewarding label guesses rather than evidence-backed diagnosis.
