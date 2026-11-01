FUNCTION_BLOCK FB_CB_ConsumerChecks
VAR_OUTPUT
    Done : BOOL;
    Passed : BOOL;
    FailedCase : UINT;
END_VAR
VAR
    a : CB.FB_CB_Session;
    b : CB.FB_CB_Session;
    ca : CB.ST_CB_Config := (DomainId := 1, SchemaId := 101, TimeoutUs := 500000, DigitalCount := 2, SignedCount := 1, UnsignedCount := 1, RealCount := 1);
    cb : CB.ST_CB_Config := (DomainId := 2, SchemaId := 202, TimeoutUs := 500000, DigitalCount := 3, SignedCount := 1, UnsignedCount := 1, RealCount := 1);
    ra : CB.ST_CB_Request;
    rb : CB.ST_CB_Request;
    ha : CB.ST_CB_Image;
    hb : CB.ST_CB_Image;
    dout : CB.FB_CB_DO;
    aout : CB.FB_CB_AO;
    capture : CB.FB_CB_OutputCapture;
    commands : CB.ST_CB_Image;
    mask : ARRAY[0..63] OF BOOL;
    signedMask : ARRAY[0..31] OF BOOL;
    unsignedMask : ARRAY[0..31] OF BOOL;
    realMask : ARRAY[0..15] OF BOOL;
    suppressed : CB.ST_CB_Numeric;
END_VAR
// Offline-buildable conformance example. Run on a separate test target later;
// building this POU is not a runtime pass. First failing case is retained.
IF Done THEN RETURN; END_IF;
ha.Digital[0] := TRUE;
ha.Numeric.Signed[0] := -32768;
hb.Numeric.Unsigned[0] := 4294967295;
a(Hardware := ha, Config := ca, NowUs := 1000, BootId := 7001, Request := ra);
b(Hardware := hb, Config := cb, NowUs := 1000, BootId := 7001, Request := rb);
IF NOT a.Image.Digital[0] OR a.Status.SimApplied OR (a.Image.Numeric.Signed[0] <> -32768)
    OR (b.Image.Numeric.Unsigned[0] <> 4294967295) THEN FailedCase := 1; END_IF;

ra.SimRequest := TRUE;
ra.RequestedSequence := 4; // stale staging must not apply on entry
ra.Slots[0].Data.Digital[0] := TRUE;
a(Hardware := ha, Config := ca, NowUs := 2000, BootId := 7001, Request := ra);
b(Hardware := hb, Config := cb, NowUs := 2000, BootId := 7001, Request := rb);
IF (FailedCase = 0) AND (a.Image.Digital[0] OR (a.Status.AppliedSequence <> 0)
    OR b.Status.SimApplied OR (b.Image.Numeric.Unsigned[0] <> 4294967295)) THEN FailedCase := 2; END_IF;

ra.Slots[0].Valid := TRUE;
ra.Slots[0].DomainId := 1;
ra.Slots[0].SchemaId := 101;
ra.Slots[0].Epoch := 100;
ra.Slots[0].Sequence := 5;
ra.Slots[0].Data.Numeric.Signed[0] := -2147483647;
ra.Slots[0].Data.Numeric.Unsigned[0] := 4294967295;
ra.Slots[0].Data.Numeric.RealValue[0] := -123.5; // raw negative is legal; no conveyor assumptions
ra.RequestedSlot := 0;
ra.RequestedEpoch := 100;
ra.RequestedSequence := 5;
ra.Heartbeat := 1;
a(Hardware := ha, Config := ca, NowUs := 3000, BootId := 7001, Request := ra);
IF (FailedCase = 0) AND ((a.Status.AppliedSequence <> 5) OR NOT a.Image.Digital[0]
    OR (a.Image.Numeric.Signed[0] <> -2147483647) OR (a.Image.Numeric.Unsigned[0] <> 4294967295)
    OR (a.Image.Numeric.RealValue[0] <> -123.5)) THEN FailedCase := 3; END_IF;

// Partial/invalid next image leaves every bank at the prior coherent revision.
ra.Slots[1] := ra.Slots[0];
ra.Slots[1].Sequence := 6;
ra.Slots[1].Valid := FALSE;
ra.Slots[1].Data.Digital[0] := FALSE;
ra.RequestedSlot := 1;
ra.RequestedSequence := 6;
a(Hardware := ha, Config := ca, NowUs := 4000, BootId := 7001, Request := ra);
IF (FailedCase = 0) AND ((a.Status.AppliedSequence <> 5) OR NOT a.Image.Digital[0]
    OR (a.Status.InvalidCount <> 1)) THEN FailedCase := 4; END_IF;

// Timeout uses microseconds, not a scan count. B stays in hardware mode.
a(Hardware := ha, Config := ca, NowUs := 600000, BootId := 7001, Request := ra);
b(Hardware := hb, Config := cb, NowUs := 600000, BootId := 7001, Request := rb);
IF (FailedCase = 0) AND (NOT a.Status.ConnectorStale OR NOT a.Image.Digital[0]
    OR (a.Status.AppliedSequence <> 5) OR b.Status.SimApplied) THEN FailedCase := 5; END_IF;
ra.Heartbeat := 2;
ra.Slots[1].Valid := TRUE; // heartbeat recovery cannot publish staged image
a(Hardware := ha, Config := ca, NowUs := 610000, BootId := 7001, Request := ra);
IF (FailedCase = 0) AND (a.Status.ConnectorStale OR (a.Status.AppliedSequence <> 5)) THEN FailedCase := 6; END_IF;
ra.Slots[1].Sequence := 7;
ra.RequestedSequence := 7;
a(Hardware := ha, Config := ca, NowUs := 620000, BootId := 7001, Request := ra);
IF (FailedCase = 0) AND ((a.Status.AppliedSequence <> 7) OR a.Image.Digital[0]
    OR (a.Status.SkippedCount <> 1)) THEN FailedCase := 7; END_IF;

commands.Digital[0] := TRUE;
commands.Numeric.Signed[0] := -99;
mask[0] := TRUE;
signedMask[0] := TRUE;
dout(Commands := commands.Digital, Suppress := mask);
aout(Commands := commands.Numeric, SuppressSigned := signedMask,
    SuppressUnsigned := unsignedMask, SuppressReal := realMask, SuppressedValues := suppressed);
capture(InputStatus := a.Status, Commands := commands, NowUs := 620001);
IF (FailedCase = 0) AND (NOT dout.Observed[0] OR dout.Physical[0]
    OR (aout.Observed.Signed[0] <> -99) OR (aout.Physical.Signed[0] <> 0)
    OR (capture.SourceSequence <> 7) OR NOT capture.SourceSimulated
    OR (capture.PublicationRevision <> 2) OR (capture.CaptureCycle <> a.Status.Cycle)) THEN FailedCase := 8; END_IF;
ra.SimRequest := FALSE;
a(Hardware := ha, Config := ca, NowUs := 630000, BootId := 7001, Request := ra);
IF (FailedCase = 0) AND (a.Status.SimApplied OR NOT a.Image.Digital[0]
    OR (a.Image.Numeric.Signed[0] <> -32768)) THEN FailedCase := 9; END_IF;

// An independently simulated B domain has its own schema, epoch, slot and image.
rb.SimRequest := TRUE;
b(Hardware := hb, Config := cb, NowUs := 640000, BootId := 7001, Request := rb);
rb.Slots[0].Valid := TRUE;
rb.Slots[0].DomainId := 2;
rb.Slots[0].SchemaId := 202;
rb.Slots[0].Epoch := 200;
rb.Slots[0].Sequence := 1;
rb.Slots[0].Data.Digital[2] := TRUE;
rb.Slots[0].Data.Numeric.Unsigned[0] := 37;
rb.RequestedSlot := 0;
rb.RequestedEpoch := 200;
rb.RequestedSequence := 1;
rb.Heartbeat := 1;
b(Hardware := hb, Config := cb, NowUs := 650000, BootId := 7001, Request := rb);
a(Hardware := ha, Config := ca, NowUs := 650000, BootId := 7001, Request := ra);
IF (FailedCase = 0) AND ((b.Status.AppliedEpoch <> 200) OR NOT b.Image.Digital[2]
    OR (b.Image.Numeric.Unsigned[0] <> 37) OR a.Status.SimApplied
    OR (a.Status.AppliedEpoch <> 100)) THEN FailedCase := 10; END_IF;
ra.SimRequest := TRUE;
a(Hardware := ha, Config := ca, NowUs := 660000, BootId := 7001, Request := ra);
b(Hardware := hb, Config := cb, NowUs := 660000, BootId := 7001, Request := rb);
IF (FailedCase = 0) AND ((a.Status.AppliedSequence <> 0) OR a.Image.Digital[0]
    OR (b.Status.AppliedSequence <> 1) OR NOT b.Image.Digital[2]) THEN FailedCase := 11; END_IF;

// Explicit simulation reset zeros B without dropping its simulation authority.
rb.SimulationResetRequest := TRUE;
b(Hardware := hb, Config := cb, NowUs := 670000, BootId := 7001, Request := rb);
IF (FailedCase = 0) AND (NOT b.Status.SimApplied OR b.Image.Digital[2]
    OR (b.Image.Numeric.Unsigned[0] <> 0) OR (b.Status.AppliedSequence <> 0)
    OR (b.Status.SimulationResetCount <> 1)) THEN FailedCase := 12; END_IF;
rb.SimulationResetRequest := FALSE;
rb.RequestedSequence := 2;
rb.Slots[0].Sequence := 2;
b(Hardware := hb, Config := cb, NowUs := 680000, BootId := 7001, Request := rb);
rb.SessionResetRequest := TRUE;
b(Hardware := hb, Config := cb, NowUs := 690000, BootId := 7001, Request := rb);
IF (FailedCase = 0) AND (NOT b.Image.Digital[2] OR (b.Status.AppliedSequence <> 0)
    OR (b.Status.SessionResetCount <> 1)) THEN FailedCase := 13; END_IF;

// A changed schema may not relabel or republish an existing domain image.
cb.SchemaId := 203;
b(Hardware := hb, Config := cb, NowUs := 700000, BootId := 7001, Request := rb);
IF (FailedCase = 0) AND (NOT b.Status.ReconfigureRequired OR (b.Status.SchemaId <> 202)
    OR NOT b.Image.Digital[2]) THEN FailedCase := 14; END_IF;
Done := TRUE;
Passed := FailedCase = 0;
END_FUNCTION_BLOCK
