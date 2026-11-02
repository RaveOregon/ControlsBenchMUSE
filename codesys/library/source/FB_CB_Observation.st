FUNCTION_BLOCK FB_CB_Observation
VAR_INPUT
    Enable : BOOL := TRUE; // FALSE keeps the last frame; the gap is counted when re-enabled
    InputStatus : ST_CB_Status; // Status of the same domain session, this cycle
    RawInputs : ST_CB_Image; // the Hardware image given to the session this cycle
    SelectedInputs : ST_CB_Image; // the session Image the application consumed
    Commands : ST_CB_Image; // authentic commands, before suppression
    Physical : ST_CB_Image; // physical sink values, after suppression
    Suppressed : ST_CB_ImageMask; // applied suppression masks from the DO/AO taps
    Taps : ST_CB_Image; // explicitly configured observation taps packed by the machine map
    TapSchemaId : UDINT; // tap-list fingerprint from the machine map; 0 when none is configured
    NowUs : ULINT;
END_VAR
VAR_OUTPUT
    PublicationRevision : ULINT; // odd while updating; even after publication
    Frame : ST_CB_ObservationFrame;
END_VAR
VAR
    haveCycle : BOOL;
    lastCycle : ULINT;
    anySuppressed : BOOL;
    i : UINT;
END_VAR
// Passive observation: needs no simulation authority or suppression and writes
// nothing back. Call once per cycle after the output taps, in the session's task.
// Fixed-size copy, no allocation, no waiting on any transport.
IF NOT Enable THEN
    RETURN;
END_IF;
anySuppressed := FALSE;
FOR i := 0 TO 63 DO
    anySuppressed := anySuppressed OR Suppressed.Digital[i];
END_FOR;
FOR i := 0 TO 31 DO
    anySuppressed := anySuppressed OR Suppressed.Numeric.Signed[i] OR Suppressed.Numeric.Unsigned[i];
END_FOR;
FOR i := 0 TO 15 DO
    anySuppressed := anySuppressed OR Suppressed.Numeric.RealValue[i];
END_FOR;
PublicationRevision := PublicationRevision + 1;
IF haveCycle THEN
    IF InputStatus.Cycle = lastCycle THEN
        Frame.RepeatedCycles := Frame.RepeatedCycles + 1;
    ELSIF InputStatus.Cycle > lastCycle + 1 THEN
        Frame.MissedCycles := Frame.MissedCycles + (InputStatus.Cycle - lastCycle - 1);
    END_IF;
END_IF;
haveCycle := TRUE;
lastCycle := InputStatus.Cycle;
Frame.FrameFormat := GVL_CB.FRAME_FORMAT_VERSION;
Frame.FrameSequence := Frame.FrameSequence + 1;
Frame.BootIdentity := InputStatus.BootIdentity;
Frame.DomainId := InputStatus.DomainId;
Frame.SchemaId := InputStatus.SchemaId;
Frame.TapSchemaId := TapSchemaId;
Frame.SourceCycle := InputStatus.Cycle;
Frame.SourceTimeUs := NowUs;
Frame.CapturePhase := GVL_CB.PHASE_POST_OUTPUT;
Frame.SimApplied := InputStatus.SimApplied;
Frame.ConnectorStale := InputStatus.ConnectorStale;
Frame.ConfigValid := InputStatus.ConfigValid;
Frame.ClockValid := InputStatus.ClockValid;
Frame.ReconfigureRequired := InputStatus.ReconfigureRequired;
Frame.AnySuppressed := anySuppressed;
Frame.AppliedEpoch := InputStatus.AppliedEpoch;
Frame.AppliedSequence := InputStatus.AppliedSequence;
Frame.RawInputs := RawInputs;
Frame.SelectedInputs := SelectedInputs;
Frame.Commands := Commands;
Frame.Physical := Physical;
Frame.Suppressed := Suppressed;
Frame.Taps := Taps;
PublicationRevision := PublicationRevision + 1;
END_FUNCTION_BLOCK
