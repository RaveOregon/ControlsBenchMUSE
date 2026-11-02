FUNCTION_BLOCK FB_CB_ConsumerChecks
VAR_OUTPUT
    Done : BOOL;
    Passed : BOOL;
    FailedCase : UINT; // first failing case; 0 when every case passed
    CasesRun : UINT;
END_VAR
VAR
    a : CB.FB_CB_Session;
    b : CB.FB_CB_Session;
    c : CB.FB_CB_Session;
    d : CB.FB_CB_Session;
    e : CB.FB_CB_Session;
    cfgA : CB.ST_CB_Config;
    cfgB : CB.ST_CB_Config;
    cfgC : CB.ST_CB_Config;
    cfgD : CB.ST_CB_Config;
    reqA : CB.ST_CB_Request;
    reqB : CB.ST_CB_Request;
    reqC : CB.ST_CB_Request;
    reqD : CB.ST_CB_Request;
    reqE : CB.ST_CB_Request;
    hwA : CB.ST_CB_Image;
    hwB : CB.ST_CB_Image;
    hwC : CB.ST_CB_Image;
    t : ULINT; // synthetic monotonic microseconds
    base : ULINT;
    boot : ULINT := 7001;
    k : UINT;
    flag : BOOL;
    flag2 : BOOL;
    markCycle : ULINT;
    markCount : ULINT;
    minDint : DINT;
    nanBits : CB.U_CB_Real32;
    infBits : CB.U_CB_Real32;
    probe : CB.U_CB_Real32;
    dout : CB.FB_CB_DO;
    aout : CB.FB_CB_AO;
    capture : CB.FB_CB_OutputCapture;
    obs : CB.FB_CB_Observation;
    commands : CB.ST_CB_Image;
    physical : CB.ST_CB_Image;
    substitute : CB.ST_CB_Image;
    taps : CB.ST_CB_Image;
    suppress : CB.ST_CB_ImageMask;
    applied : CB.ST_CB_ImageMask;
    tankIn : ST_TANK_Inputs;
    tankBack : ST_TANK_Inputs;
    tankTaps : ST_TANK_Taps;
    tankCfg : CB.ST_CB_Config;
    tankImage : CB.ST_CB_Image;
    tankTapImage : CB.ST_CB_Image;
    convIn : ST_CONV_Inputs;
    convBack : ST_CONV_Inputs;
    convOut : ST_CONV_Outputs;
    convSink : ST_CONV_Outputs;
    convCfg : CB.ST_CB_Config;
END_VAR
// Offline-buildable conformance harness. Compiling it is not a runtime pass.
// Execute it once on a separate test target; Done, Passed and FailedCase are
// its only results. Synthetic timestamps and boot identities; no hardware map.
IF Done THEN
    RETURN;
END_IF;
minDint := -2147483647 - 1;
nanBits.AsBits := 16#7FC00001; // quiet NaN with a payload bit; the bits must survive unchanged
infBits.AsBits := 16#7F800000; // +infinity
// Domain A: two digital, signed 32/16-bit, unsigned 32-bit, finite REAL and NaN-capable REAL.
cfgA.DomainId := 1;
cfgA.SchemaId := 101;
cfgA.TimeoutUs := 500000;
cfgA.DigitalCount := 2;
cfgA.SignedCount := 2;
cfgA.UnsignedCount := 1;
cfgA.RealCount := 2;
cfgA.SignedBits[0] := 32;
cfgA.SignedBits[1] := 16;
cfgA.UnsignedBits[0] := 32;
cfgA.RealNonFiniteAllowed[1] := TRUE;
// Domain B: another shape, a 12-bit unsigned channel and a 200 ms timeout.
cfgB.DomainId := 2;
cfgB.SchemaId := 202;
cfgB.TimeoutUs := 200000;
cfgB.DigitalCount := 3;
cfgB.SignedCount := 1;
cfgB.UnsignedCount := 1;
cfgB.RealCount := 1;
cfgB.SignedBits[0] := 16;
cfgB.UnsignedBits[0] := 12;
// Domain C: invalid, a configured channel without a native width.
cfgC.DomainId := 3;
cfgC.SchemaId := 303;
cfgC.TimeoutUs := 500000;
cfgC.SignedCount := 1;
hwA.Digital[0] := TRUE;
hwA.Numeric.Signed[0] := minDint;
hwA.Numeric.Signed[1] := -32768;
hwA.Numeric.Unsigned[0] := 4294967295;
hwA.Numeric.RealValue[0] := -123.5;
hwB.Digital[0] := TRUE;
hwB.Numeric.Unsigned[0] := 4000;

// 1 Cold start is hardware passthrough with exact raw boundaries and no fresh link.
t := 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (NOT a.Image.Digital[0] OR a.Status.SimApplied OR NOT a.Status.ConnectorStale
    OR NOT a.Status.ConfigValid OR (a.Image.Numeric.Signed[0] <> minDint) OR (a.Image.Numeric.Signed[1] <> -32768)
    OR (a.Image.Numeric.Unsigned[0] <> 4294967295) OR (a.Image.Numeric.RealValue[0] <> -123.5)
    OR (b.Image.Numeric.Unsigned[0] <> 4000) OR NOT b.Image.Digital[0]
    OR (a.Status.ProtocolVersion <> CB.GVL_CB.PROTOCOL_VERSION)) THEN
    FailedCase := 1;
END_IF;

// 2 A commit edge in hardware mode is consumed and visibly ignored.
reqA.Slots[0].Valid := TRUE;
reqA.Slots[0].DomainId := 1;
reqA.Slots[0].SchemaId := 101;
reqA.Slots[0].Epoch := 100;
reqA.Slots[0].Sequence := 3;
reqA.Slots[0].Data.Digital[1] := TRUE;
reqA.RequestedSlot := 0;
reqA.RequestedEpoch := 100;
reqA.RequestedSequence := 3;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_NOT_SIMULATED) OR (a.Status.ConsumedSequence <> 3)
    OR (a.Status.NotSimulatedCount <> 1) OR (a.Status.AppliedSequence <> 0) OR a.Image.Digital[1]) THEN
    FailedCase := 2;
END_IF;

// 3 Simulation entry selects raw zero at once; a request staged in the same cycle never applies.
reqA.SimRequest := TRUE;
reqA.Slots[0].Sequence := 4;
reqA.RequestedSequence := 4;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (NOT a.Status.SimApplied OR a.Image.Digital[0] OR (a.Image.Numeric.Signed[0] <> 0)
    OR (a.Image.Numeric.Unsigned[0] <> 0) OR (a.Image.Numeric.RealValue[0] <> 0.0) OR (a.Status.AppliedSequence <> 0)
    OR (a.Status.ActiveSlot <> CB.GVL_CB.NO_SLOT) OR (a.Status.SimulationEntryCount <> 1)
    OR (a.Status.ConsumedResult <> CB.GVL_CB.RESULT_SIMULATION_ENTRY) OR (a.Status.ConsumedSequence <> 4)
    OR b.Status.SimApplied OR (b.Image.Numeric.Unsigned[0] <> 4000)) THEN
    FailedCase := 3;
END_IF;

// 4 A heartbeat makes the link fresh without applying staged data.
reqA.Heartbeat := 1;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND (a.Status.ConnectorStale OR (a.Status.AppliedSequence <> 0) OR (a.Status.LastHeartbeat <> 1)
    OR (a.Status.LastHeartbeatTimeUs <> t)) THEN
    FailedCase := 4;
END_IF;

// 5 A complete mixed-bank commit applies every bank in one revision with raw bits intact.
reqA.Slots[0].Valid := FALSE;
reqA.Slots[0].Data.Digital[0] := TRUE;
reqA.Slots[0].Data.Digital[1] := TRUE;
reqA.Slots[0].Data.Numeric.Signed[0] := minDint;
reqA.Slots[0].Data.Numeric.Signed[1] := 32767;
reqA.Slots[0].Data.Numeric.Unsigned[0] := 4294967295;
reqA.Slots[0].Data.Numeric.RealValue[0] := -123.5;
reqA.Slots[0].Data.Numeric.RealValue[1] := nanBits.AsReal;
reqA.Slots[0].Epoch := 100;
reqA.Slots[0].Sequence := 5;
reqA.Slots[0].Valid := TRUE;
reqA.RequestedSlot := 0;
reqA.RequestedEpoch := 100;
reqA.RequestedSequence := 5;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
probe.AsReal := a.Image.Numeric.RealValue[1];
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_ACCEPTED) OR (a.Status.AppliedEpoch <> 100)
    OR (a.Status.AppliedSequence <> 5) OR (a.Status.ActiveSlot <> 0) OR (a.Status.AppliedCycle <> a.Status.Cycle)
    OR NOT a.Image.Digital[0] OR NOT a.Image.Digital[1] OR (a.Image.Numeric.Signed[0] <> minDint)
    OR (a.Image.Numeric.Signed[1] <> 32767) OR (a.Image.Numeric.Unsigned[0] <> 4294967295)
    OR (a.Image.Numeric.RealValue[0] <> -123.5) OR (probe.AsBits <> nanBits.AsBits) OR (a.Status.CommitCount <> 1)) THEN
    FailedCase := 5;
END_IF;

// 6 A value outside a channel's declared native width is rejected, never narrowed.
reqA.Slots[1] := reqA.Slots[0];
reqA.Slots[1].Valid := FALSE;
reqA.Slots[1].Data.Numeric.Signed[1] := 32768;
reqA.Slots[1].Sequence := 6;
reqA.Slots[1].Valid := TRUE;
reqA.RequestedSlot := 1;
reqA.RequestedSequence := 6;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_REPRESENTATION)
    OR (a.Status.RejectBank <> CB.GVL_CB.BANK_SIGNED) OR (a.Status.RejectIndex <> 1)
    OR (a.Status.RepresentationRejectedCount <> 1) OR (a.Status.AppliedSequence <> 5)
    OR (a.Image.Numeric.Signed[1] <> 32767)) THEN
    FailedCase := 6;
END_IF;

// 7 Data in an unconfigured channel is rejected.
reqA.Slots[1].Data.Numeric.Signed[1] := -32768;
reqA.Slots[1].Data.Digital[2] := TRUE;
reqA.Slots[1].Sequence := 7;
reqA.RequestedSequence := 7;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_REPRESENTATION)
    OR (a.Status.RejectBank <> CB.GVL_CB.BANK_DIGITAL) OR (a.Status.RejectIndex <> 2)
    OR (a.Status.RepresentationRejectedCount <> 2)) THEN
    FailedCase := 7;
END_IF;

// 8 Infinity on a finite-only REAL channel is rejected.
reqA.Slots[1].Data.Digital[2] := FALSE;
reqA.Slots[1].Data.Numeric.RealValue[0] := infBits.AsReal;
reqA.Slots[1].Sequence := 8;
reqA.RequestedSequence := 8;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_REPRESENTATION)
    OR (a.Status.RejectBank <> CB.GVL_CB.BANK_REAL) OR (a.Status.RejectIndex <> 0)
    OR (a.Status.AppliedSequence <> 5)) THEN
    FailedCase := 8;
END_IF;

// 9 An incomplete (not yet valid) slot leaves every bank at the prior revision.
reqA.Slots[1].Data.Numeric.RealValue[0] := 1.0;
reqA.Slots[1].Valid := FALSE;
reqA.Slots[1].Sequence := 9;
reqA.RequestedSequence := 9;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_INCOMPLETE_SLOT)
    OR (a.Status.IncompleteSlotCount <> 1) OR (a.Status.AppliedSequence <> 5) OR NOT a.Image.Digital[0]) THEN
    FailedCase := 9;
END_IF;

// 10 Slot metadata from another schema is rejected.
reqA.Slots[1].Valid := TRUE;
reqA.Slots[1].SchemaId := 999;
reqA.Slots[1].Sequence := 10;
reqA.RequestedSequence := 10;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_METADATA_MISMATCH)
    OR (a.Status.MetadataMismatchCount <> 1)) THEN
    FailedCase := 10;
END_IF;
reqA.Slots[1].SchemaId := 101;

// 11 Requesting the active slot is rejected; the acknowledgement names the slot.
reqA.RequestedSlot := 0;
reqA.RequestedSequence := 11;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_INVALID_SLOT)
    OR (a.Status.InvalidSlotCount <> 1) OR (a.Status.ConsumedSlot <> 0)) THEN
    FailedCase := 11;
END_IF;

// 12 A slot index outside 0..1 is rejected.
reqA.RequestedSlot := 2;
reqA.RequestedSequence := 12;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_INVALID_SLOT)
    OR (a.Status.InvalidSlotCount <> 2)) THEN
    FailedCase := 12;
END_IF;

// 13 A duplicate of the applied epoch/sequence changes nothing.
reqA.Slots[1].Sequence := 5;
reqA.RequestedSlot := 1;
reqA.RequestedSequence := 5;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_DUPLICATE) OR (a.Status.DuplicateCount <> 1)
    OR (a.Status.AppliedSequence <> 5) OR (a.Status.ActiveSlot <> 0)) THEN
    FailedCase := 13;
END_IF;

// 14 An older sequence in the same epoch is stale.
reqA.Slots[1].Sequence := 4;
reqA.RequestedSequence := 4;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_STALE) OR (a.Status.StaleCount <> 1)) THEN
    FailedCase := 14;
END_IF;

// 15 A skipped sequence is accepted and counted.
reqA.Slots[1].Sequence := 7;
reqA.RequestedSequence := 7;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_ACCEPTED) OR (a.Status.AppliedSequence <> 7)
    OR (a.Status.SkippedCount <> 1) OR (a.Status.ActiveSlot <> 1) OR (a.Image.Numeric.Signed[1] <> -32768)
    OR (a.Image.Numeric.RealValue[0] <> 1.0)) THEN
    FailedCase := 15;
END_IF;

// 16 A new epoch is refused while the current session is fresh.
reqA.Heartbeat := 2;
reqA.Slots[0].Valid := FALSE;
reqA.Slots[0].Epoch := 200;
reqA.Slots[0].Sequence := 1;
reqA.Slots[0].Valid := TRUE;
reqA.RequestedSlot := 0;
reqA.RequestedEpoch := 200;
reqA.RequestedSequence := 1;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_EPOCH_REJECTED)
    OR (a.Status.EpochRejectedCount <> 1) OR (a.Status.AppliedEpoch <> 100)) THEN
    FailedCase := 16;
END_IF;

// 17 Link loss: strictly more than TimeoutUs without a heartbeat holds the image and shows staleness.
base := t;
a(Hardware := hwA, Config := cfgA, NowUs := base + 500000, BootId := boot, Request := reqA);
flag := a.Status.ConnectorStale;
t := base + 500001;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND (flag OR NOT a.Status.ConnectorStale OR NOT a.Status.SimApplied
    OR (a.Status.AppliedSequence <> 7) OR NOT a.Image.Digital[0] OR (a.Image.Numeric.Signed[0] <> minDint)) THEN
    FailedCase := 17;
END_IF;

// 18 Heartbeat-only recovery clears staleness but publishes nothing staged.
reqA.Heartbeat := 3;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND (a.Status.ConnectorStale OR (a.Status.AppliedSequence <> 7) OR (a.Status.AppliedEpoch <> 100)) THEN
    FailedCase := 18;
END_IF;

// 19 After elapsed staleness a new epoch is accepted, even in the cycle its first heartbeat arrives.
t := t + 500001;
reqA.Heartbeat := 4;
reqA.Slots[0].Valid := FALSE;
reqA.Slots[0].Epoch := 300;
reqA.Slots[0].Sequence := 2;
reqA.Slots[0].Data.Digital[1] := FALSE;
reqA.Slots[0].Valid := TRUE;
reqA.RequestedSlot := 0;
reqA.RequestedEpoch := 300;
reqA.RequestedSequence := 2;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_ACCEPTED) OR (a.Status.AppliedEpoch <> 300)
    OR (a.Status.AppliedSequence <> 2) OR a.Status.ConnectorStale OR a.Image.Digital[1]) THEN
    FailedCase := 19;
END_IF;

// 20 Changing only the epoch, slot or payload is not a commit edge.
reqA.Slots[1].Valid := FALSE;
reqA.Slots[1].Epoch := 300;
reqA.Slots[1].Sequence := 2;
reqA.Slots[1].Valid := TRUE;
reqA.RequestedSlot := 1;
reqA.RequestedEpoch := 301;
markCycle := a.Status.ConsumedCycle;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedCycle <> markCycle) OR (a.Status.AppliedEpoch <> 300)) THEN
    FailedCase := 20;
END_IF;

// 21 RequestedEpoch = 0 with RequestedSequence = 0 is the idle request, not an error.
reqA.RequestedEpoch := 0;
reqA.RequestedSequence := 0;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_IDLE_CLEARED) OR (a.Status.IdleClearCount <> 1)
    OR (a.Status.InvalidSlotCount <> 2) OR (a.Status.MetadataMismatchCount <> 1) OR (a.Status.AppliedEpoch <> 300)) THEN
    FailedCase := 21;
END_IF;

// 22 Session reset clears accepted metadata, keeps the image and consumes a staged commit.
reqA.Slots[1].Valid := FALSE;
reqA.Slots[1].Epoch := 300;
reqA.Slots[1].Sequence := 3;
reqA.Slots[1].Valid := TRUE;
reqA.RequestedSlot := 1;
reqA.RequestedEpoch := 300;
reqA.RequestedSequence := 3;
reqA.SessionResetRequest := TRUE;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_SESSION_RESET) OR (a.Status.SessionResetCount <> 1)
    OR (a.Status.AppliedEpoch <> 0) OR (a.Status.AppliedSequence <> 0) OR (a.Status.ActiveSlot <> CB.GVL_CB.NO_SLOT)
    OR NOT a.Status.SimApplied OR NOT a.Image.Digital[0] OR (a.Image.Numeric.Signed[0] <> minDint)) THEN
    FailedCase := 22;
END_IF;

// 23 After the reset any epoch starts a new session; a held reset flag does not repeat.
reqA.Slots[1].Valid := FALSE;
reqA.Slots[1].Epoch := 400;
reqA.Slots[1].Sequence := 4;
reqA.Slots[1].Valid := TRUE;
reqA.RequestedEpoch := 400;
reqA.RequestedSequence := 4;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_ACCEPTED) OR (a.Status.AppliedEpoch <> 400)
    OR (a.Status.SessionResetCount <> 1) OR (a.Status.ActiveSlot <> 1)) THEN
    FailedCase := 23;
END_IF;
reqA.SessionResetRequest := FALSE;

// 24 Simulation Reset zeros the image and clears metadata while staying simulated.
reqA.SimulationResetRequest := TRUE;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.ConsumedResult <> CB.GVL_CB.RESULT_SIMULATION_RESET)
    OR (a.Status.SimulationResetCount <> 1) OR NOT a.Status.SimApplied OR a.Image.Digital[0]
    OR (a.Image.Numeric.Signed[0] <> 0) OR (a.Image.Numeric.Unsigned[0] <> 0) OR (a.Status.AppliedEpoch <> 0)
    OR (a.Status.SessionResetCount <> 1)) THEN
    FailedCase := 24;
END_IF;
reqA.SimulationResetRequest := FALSE;

// 25 A complete commit after Simulation Reset establishes conditions again.
reqA.Slots[0].Valid := FALSE;
reqA.Slots[0].Epoch := 500;
reqA.Slots[0].Sequence := 5;
reqA.Slots[0].Data.Digital[0] := FALSE;
reqA.Slots[0].Data.Digital[1] := TRUE;
reqA.Slots[0].Valid := TRUE;
reqA.RequestedSlot := 0;
reqA.RequestedEpoch := 500;
reqA.RequestedSequence := 5;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((a.Status.AppliedEpoch <> 500) OR (a.Status.AppliedSequence <> 5) OR NOT a.Image.Digital[1]
    OR a.Image.Digital[0]) THEN
    FailedCase := 25;
END_IF;

// 26 Output taps observe authentic commands; suppression changes only the physical sink.
commands.Digital[0] := TRUE;
commands.Digital[1] := FALSE;
commands.Numeric.Signed[0] := -99;
commands.Numeric.RealValue[0] := 12.5;
suppress.Digital[0] := TRUE; // de-energised while suppressed
suppress.Digital[1] := TRUE; // fail-safe energised channel
substitute.Digital[1] := TRUE;
suppress.Numeric.Signed[0] := TRUE; // raw zero substitute
dout(Commands := commands.Digital, Suppress := suppress.Digital, SuppressedValues := substitute.Digital);
aout(Commands := commands.Numeric, Suppress := suppress.Numeric, SuppressedValues := substitute.Numeric);
physical.Digital := dout.Physical;
physical.Numeric := aout.Physical;
applied.Digital := dout.Applied;
applied.Numeric := aout.Applied;
capture(InputStatus := a.Status, Commands := commands, NowUs := t + 1);
IF (FailedCase = 0) AND (NOT dout.Observed[0] OR dout.Physical[0] OR dout.Observed[1] OR NOT dout.Physical[1]
    OR (dout.SuppressedCount <> 2) OR (aout.Observed.Signed[0] <> -99) OR (aout.Physical.Signed[0] <> 0)
    OR (aout.Physical.RealValue[0] <> 12.5) OR (aout.SuppressedCount <> 1) OR (capture.SourceEpoch <> 500)
    OR (capture.SourceSequence <> 5) OR NOT capture.SourceSimulated OR (capture.PublicationRevision <> 2)
    OR (capture.CaptureCycle <> a.Status.Cycle) OR NOT capture.Observed.Digital[0]) THEN
    FailedCase := 26;
END_IF;

// 27 The observation frame keeps raw hardware, selected inputs, commands and physical sink apart.
taps.Numeric.RealValue[0] := 42.0;
obs(InputStatus := a.Status, RawInputs := a.Hardware, SelectedInputs := a.Image, Commands := commands,
    Physical := physical, Suppressed := applied, Taps := taps, TapSchemaId := 77, NowUs := t + 2);
IF (FailedCase = 0) AND (NOT obs.Frame.SimApplied OR NOT obs.Frame.RawInputs.Digital[0]
    OR obs.Frame.SelectedInputs.Digital[0] OR NOT obs.Frame.SelectedInputs.Digital[1] OR NOT obs.Frame.Commands.Digital[0]
    OR obs.Frame.Physical.Digital[0] OR NOT obs.Frame.Suppressed.Digital[0] OR NOT obs.Frame.AnySuppressed
    OR (obs.Frame.Taps.Numeric.RealValue[0] <> 42.0) OR (obs.Frame.TapSchemaId <> 77) OR (obs.Frame.FrameSequence <> 1)
    OR (obs.PublicationRevision <> 2) OR (obs.Frame.SourceCycle <> a.Status.Cycle)
    OR (obs.Frame.CapturePhase <> CB.GVL_CB.PHASE_POST_OUTPUT) OR (obs.Frame.FrameFormat <> CB.GVL_CB.FRAME_FORMAT_VERSION)
    OR (obs.Frame.AppliedSequence <> 5) OR (obs.Frame.DomainId <> 1) OR (obs.Frame.MissedCycles <> 0)) THEN
    FailedCase := 27;
END_IF;

// 28 Missed and repeated cycles are counted at the source.
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
obs(InputStatus := a.Status, NowUs := t);
obs(InputStatus := a.Status, NowUs := t);
IF (FailedCase = 0) AND ((obs.Frame.MissedCycles <> 1) OR (obs.Frame.RepeatedCycles <> 1) OR (obs.Frame.FrameSequence <> 3)) THEN
    FailedCase := 28;
END_IF;

// 29 Exit Simulation restores hardware passthrough exactly; B is unaffected.
reqA.SimRequest := FALSE;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (a.Status.SimApplied OR NOT a.Image.Digital[0] OR (a.Image.Numeric.Signed[0] <> minDint)
    OR (a.Image.Numeric.Unsigned[0] <> 4294967295) OR (a.Image.Numeric.RealValue[0] <> -123.5) OR b.Status.SimApplied) THEN
    FailedCase := 29;
END_IF;

// 30 Passive observation in passthrough needs no simulation authority.
obs(InputStatus := a.Status, RawInputs := a.Hardware, SelectedInputs := a.Image, NowUs := t);
IF (FailedCase = 0) AND (obs.Frame.SimApplied OR NOT obs.Frame.SelectedInputs.Digital[0] OR NOT obs.Frame.RawInputs.Digital[0]
    OR (obs.Frame.SelectedInputs.Numeric.Signed[0] <> obs.Frame.RawInputs.Numeric.Signed[0])) THEN
    FailedCase := 30;
END_IF;

// 31 Domain B simulates independently with its own schema, epoch and 12-bit channel.
markCount := a.Status.CommitCount;
reqB.SimRequest := TRUE;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
reqB.Heartbeat := 1;
reqB.Slots[0].DomainId := 2;
reqB.Slots[0].SchemaId := 202;
reqB.Slots[0].Epoch := 900;
reqB.Slots[0].Sequence := 1;
reqB.Slots[0].Data.Digital[2] := TRUE;
reqB.Slots[0].Data.Numeric.Unsigned[0] := 4095;
reqB.Slots[0].Data.Numeric.Signed[0] := -32768;
reqB.Slots[0].Valid := TRUE;
reqB.RequestedSlot := 0;
reqB.RequestedEpoch := 900;
reqB.RequestedSequence := 1;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((b.Status.ConsumedResult <> CB.GVL_CB.RESULT_ACCEPTED) OR (b.Status.AppliedEpoch <> 900)
    OR NOT b.Image.Digital[2] OR b.Image.Digital[0] OR (b.Image.Numeric.Unsigned[0] <> 4095) OR a.Status.SimApplied
    OR (a.Status.CommitCount <> markCount) OR (a.Status.AppliedEpoch <> 500)) THEN
    FailedCase := 31;
END_IF;

// 32 B rejects 4096 in its 12-bit channel; A is unaffected.
reqB.Slots[1] := reqB.Slots[0];
reqB.Slots[1].Data.Numeric.Unsigned[0] := 4096;
reqB.Slots[1].Sequence := 2;
reqB.RequestedSlot := 1;
reqB.RequestedSequence := 2;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND ((b.Status.ConsumedResult <> CB.GVL_CB.RESULT_REPRESENTATION)
    OR (b.Status.RejectBank <> CB.GVL_CB.BANK_UNSIGNED) OR (b.Image.Numeric.Unsigned[0] <> 4095)
    OR (a.Status.RepresentationRejectedCount <> 3)) THEN
    FailedCase := 32;
END_IF;

// 33 Each domain applies its own timeout.
reqA.Heartbeat := 5;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
reqA.Heartbeat := 6;
t := t + 250000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (a.Status.ConnectorStale OR NOT b.Status.ConnectorStale OR NOT b.Status.SimApplied
    OR NOT b.Image.Digital[2]) THEN
    FailedCase := 33;
END_IF;

// 34 Re-entering simulation on A zeros A again; B keeps its image.
reqA.SimRequest := TRUE;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (NOT a.Status.SimApplied OR a.Image.Digital[1] OR (a.Status.AppliedEpoch <> 0)
    OR (a.Status.SimulationEntryCount <> 2) OR NOT b.Image.Digital[2] OR (b.Status.AppliedEpoch <> 900)) THEN
    FailedCase := 34;
END_IF;

// 35 A backward clock latches ReconfigureRequired on B; requests are refused and the image held.
b(Hardware := hwB, Config := cfgB, NowUs := t - 5000, BootId := boot, Request := reqB);
flag := b.Status.ClockValid;
reqB.Slots[1].Data.Numeric.Unsigned[0] := 7;
reqB.Slots[1].Sequence := 3;
reqB.RequestedSequence := 3;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (flag OR NOT b.Status.ReconfigureRequired
    OR (b.Status.ConsumedResult <> CB.GVL_CB.RESULT_RECONFIGURE_REQUIRED) OR (b.Status.BlockedRequestCount <> 1)
    OR NOT b.Status.SimApplied OR (b.Image.Numeric.Unsigned[0] <> 4095) OR a.Status.ReconfigureRequired) THEN
    FailedCase := 35;
END_IF;

// 36 Exit Simulation is honoured while ReconfigureRequired; hardware returns.
reqB.SimRequest := FALSE;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Request := reqB);
IF (FailedCase = 0) AND (b.Status.SimApplied OR (b.Image.Numeric.Unsigned[0] <> 4000) OR NOT b.Image.Digital[0]
    OR b.Image.Digital[2]) THEN
    FailedCase := 36;
END_IF;

// 37 Local Reinitialize clears the latch, re-pins configuration and consumes staged data.
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Reinitialize := TRUE, Request := reqB);
IF (FailedCase = 0) AND (b.Status.ReconfigureRequired OR (b.Status.ReinitializeCount <> 1)
    OR (b.Status.ConsumedResult <> CB.GVL_CB.RESULT_REINITIALIZED) OR (b.Status.AppliedEpoch <> 0)
    OR NOT b.Status.ConnectorStale) THEN
    FailedCase := 37;
END_IF;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot, Reinitialize := FALSE, Request := reqB);

// 38 A changed boot identity latches ReconfigureRequired until Reinitialize adopts it.
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot + 1, Reinitialize := FALSE, Request := reqB);
flag := b.Status.ReconfigureRequired;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot + 1, Reinitialize := TRUE, Request := reqB);
IF (FailedCase = 0) AND (NOT flag OR b.Status.ReconfigureRequired OR (b.Status.BootIdentity <> boot + 1)
    OR (b.Status.ReinitializeCount <> 2)) THEN
    FailedCase := 38;
END_IF;
t := t + 1000;
b(Hardware := hwB, Config := cfgB, NowUs := t, BootId := boot + 1, Reinitialize := FALSE, Request := reqB);

// 39 A changed schema cannot relabel the domain or apply data under the old identity.
cfgA.SchemaId := 102;
reqA.Heartbeat := 7;
reqA.Slots[1].Valid := FALSE;
reqA.Slots[1].Epoch := 600;
reqA.Slots[1].Sequence := 6;
reqA.Slots[1].SchemaId := 102;
reqA.Slots[1].Valid := TRUE;
reqA.RequestedSlot := 1;
reqA.RequestedEpoch := 600;
reqA.RequestedSequence := 6;
t := t + 1000;
a(Hardware := hwA, Config := cfgA, NowUs := t, BootId := boot, Request := reqA);
IF (FailedCase = 0) AND (NOT a.Status.ReconfigureRequired OR (a.Status.SchemaId <> 101)
    OR (a.Status.ConsumedResult <> CB.GVL_CB.RESULT_RECONFIGURE_REQUIRED) OR (a.Status.AppliedEpoch <> 0)
    OR NOT a.Status.SimApplied) THEN
    FailedCase := 39;
END_IF;
cfgA.SchemaId := 101;

// 40 Invalid configuration is reported; a simulated domain holds raw zero instead of selecting hardware.
hwC.Numeric.Signed[0] := 5;
reqC.SimRequest := TRUE;
reqC.Slots[0].Valid := TRUE;
reqC.Slots[0].DomainId := 3;
reqC.Slots[0].SchemaId := 303;
reqC.Slots[0].Epoch := 1;
reqC.Slots[0].Sequence := 1;
reqC.Slots[0].Data.Numeric.Signed[0] := 9;
reqC.RequestedSlot := 0;
reqC.RequestedEpoch := 1;
reqC.RequestedSequence := 1;
t := t + 1000;
c(Hardware := hwC, Config := cfgC, NowUs := t, BootId := boot, Request := reqC);
reqC.Slots[0].Sequence := 2;
reqC.RequestedSequence := 2;
t := t + 1000;
c(Hardware := hwC, Config := cfgC, NowUs := t, BootId := boot, Request := reqC);
IF (FailedCase = 0) AND (c.Status.ConfigValid OR NOT c.Status.SimApplied OR (c.Image.Numeric.Signed[0] <> 0)
    OR (c.Status.ConsumedResult <> CB.GVL_CB.RESULT_CONFIG_INVALID) OR (c.Status.BlockedRequestCount <> 1)) THEN
    FailedCase := 40;
END_IF;

// 41 The generated non-conveyor map round-trips native values at their boundaries.
tankIn.LT101_Raw := -32768;
tankIn.TT102_Raw := 32767;
tankIn.PT103_Raw := 4095;
tankIn.LSH104 := TRUE;
tankIn.P105_RunFB := FALSE;
tankIn.FQ106_Count := 4294967295;
tankIn.AT107_Value := nanBits.AsReal;
tankImage := MAP_TANK_PackInputs(Source := tankIn);
tankBack := MAP_TANK_UnpackInputs(Image := tankImage);
tankCfg := MAP_TANK_Config(DomainId := GVL_TANK_Map.DEFAULT_DOMAIN_ID);
probe.AsReal := tankBack.AT107_Value;
IF (FailedCase = 0) AND ((tankBack.LT101_Raw <> -32768) OR (tankBack.TT102_Raw <> 32767) OR (tankBack.PT103_Raw <> 4095)
    OR NOT tankBack.LSH104 OR tankBack.P105_RunFB OR (tankBack.FQ106_Count <> 4294967295)
    OR (probe.AsBits <> nanBits.AsBits) OR (tankImage.Numeric.Signed[0] <> -32768)
    OR (tankImage.Numeric.Unsigned[0] <> 4095)
    OR (CB.F_CB_CheckImage(Image := tankImage, Config := tankCfg) <> CB.GVL_CB.RESULT_NONE)) THEN
    FailedCase := 41;
END_IF;

// 42 The generated configuration carries counts, native widths and NaN policy from the map.
IF (FailedCase = 0) AND ((tankCfg.DomainId <> 2) OR (tankCfg.SchemaId <> GVL_TANK_Map.SCHEMA_ID) OR (tankCfg.SchemaId = 0)
    OR (tankCfg.DigitalCount <> 2) OR (tankCfg.SignedCount <> 2) OR (tankCfg.SignedBits[0] <> 16)
    OR (tankCfg.UnsignedCount <> 2) OR (tankCfg.UnsignedBits[0] <> 12) OR (tankCfg.UnsignedBits[1] <> 32)
    OR (tankCfg.RealCount <> 1) OR NOT tankCfg.RealNonFiniteAllowed[0] OR (tankCfg.TimeoutUs <> 750000)) THEN
    FailedCase := 42;
END_IF;

// 43 The map's 12-bit declaration is enforced by the core check.
tankImage.Numeric.Unsigned[0] := 4096;
IF (FailedCase = 0) AND (CB.F_CB_CheckImage(Image := tankImage, Config := tankCfg) <> CB.GVL_CB.RESULT_REPRESENTATION) THEN
    FailedCase := 43;
END_IF;

// 44 PID observation taps pack into the tap image under their own fingerprint.
tankTaps.TIC102_SP := 65.0;
tankTaps.TIC102_PV := 64.5;
tankTaps.TIC102_CV := 37.25;
tankTaps.TIC102_Mode := 1;
tankTapImage := MAP_TANK_PackTaps(Source := tankTaps);
IF (FailedCase = 0) AND ((tankTapImage.Numeric.RealValue[0] <> 65.0) OR (tankTapImage.Numeric.RealValue[1] <> 64.5)
    OR (tankTapImage.Numeric.RealValue[2] <> 37.25) OR (tankTapImage.Numeric.Signed[0] <> 1)
    OR (GVL_TANK_Map.TAP_SCHEMA_ID = 0) OR (GVL_TANK_Map.TAP_SCHEMA_ID = GVL_TANK_Map.SCHEMA_ID)) THEN
    FailedCase := 44;
END_IF;

// 45 The conveyor map reproduces the M8 raw signal set with no conveyor code in the core.
convIn.PE_Entry := TRUE;
convIn.Runout_Ready := TRUE;
convIn.Encoder_Count := 4294967295;
convIn.D2_Position := 99.5;
convBack := MAP_CONV_UnpackInputs(Image := MAP_CONV_PackInputs(Source := convIn));
convCfg := MAP_CONV_Config(DomainId := GVL_CONV_Map.DEFAULT_DOMAIN_ID);
convOut.Motor_RunCmd := TRUE;
convOut.StackLight_Green := TRUE;
convSink := MAP_CONV_UnpackOutputs(Image := MAP_CONV_PackOutputs(Source := convOut));
IF (FailedCase = 0) AND (NOT convBack.PE_Entry OR NOT convBack.Runout_Ready OR convBack.PE_ExitA
    OR (convBack.Encoder_Count <> 4294967295) OR (convBack.D2_Position <> 99.5) OR (convCfg.DigitalCount <> 15)
    OR (convCfg.RealCount <> 4) OR (convCfg.UnsignedCount <> 1) OR (convCfg.SignedCount <> 0)
    OR (convCfg.UnsignedBits[0] <> 32) OR convCfg.RealNonFiniteAllowed[0] OR (convCfg.SchemaId = GVL_TANK_Map.SCHEMA_ID)
    OR NOT convSink.Motor_RunCmd OR NOT convSink.StackLight_Green OR convSink.D1_ExtendCmd) THEN
    FailedCase := 45;
END_IF;

// 46 Staleness is elapsed time, not a call count: 1 ms and 100 ms call periods agree.
cfgD := cfgA;
cfgD.DomainId := 4;
base := t + 10000;
d(Hardware := hwA, Config := cfgD, NowUs := base, BootId := boot, Request := reqD);
reqD.Heartbeat := 1;
d(Hardware := hwA, Config := cfgD, NowUs := base, BootId := boot, Request := reqD);
FOR k := 1 TO 500 DO
    d(Hardware := hwA, Config := cfgD, NowUs := base + UINT_TO_ULINT(k) * 1000, BootId := boot, Request := reqD);
END_FOR;
flag := d.Status.ConnectorStale;
d(Hardware := hwA, Config := cfgD, NowUs := base + 501000, BootId := boot, Request := reqD);
e(Hardware := hwA, Config := cfgD, NowUs := base, BootId := boot, Request := reqE);
reqE.Heartbeat := 1;
e(Hardware := hwA, Config := cfgD, NowUs := base, BootId := boot, Request := reqE);
FOR k := 1 TO 5 DO
    e(Hardware := hwA, Config := cfgD, NowUs := base + UINT_TO_ULINT(k) * 100000, BootId := boot, Request := reqE);
END_FOR;
flag2 := e.Status.ConnectorStale;
e(Hardware := hwA, Config := cfgD, NowUs := base + 600000, BootId := boot, Request := reqE);
IF (FailedCase = 0) AND (flag OR NOT d.Status.ConnectorStale OR flag2 OR NOT e.Status.ConnectorStale
    OR (d.Status.Cycle < 500) OR (e.Status.Cycle > 10)) THEN
    FailedCase := 46;
END_IF;

CasesRun := 46;
Done := TRUE;
Passed := FailedCase = 0;
END_FUNCTION_BLOCK
