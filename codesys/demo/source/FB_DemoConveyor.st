FUNCTION_BLOCK FB_DemoConveyor
VAR_INPUT
    I : ST_BenchInputImage;
    NowUs : ULINT;
    StartSequence : UDINT;
    StopSequence : UDINT;
    ResetSequence : UDINT;
    AutoRequest : BOOL;
    OfferSequence : UDINT;
    OfferItemId : UDINT;
    OfferRoute : UINT;
    CompletionAck : UDINT;
END_VAR
VAR_OUTPUT
    Q : ST_DemoStatus;
END_VAR
VAR
    prev : ST_BenchInputImage;
    initialized : BOOL;
    encoderPrevious : UDINT;
    speedCounts : ULINT;
    speedStartUs : ULINT;
    previousStart : UDINT;
    previousStop : UDINT;
    previousReset : UDINT;
    previousOffer : UDINT;
    pendingId : UDINT;
    pendingRoute : UINT;
    passedD1 : BOOL;
    passedD2 : BOOL;
    runningSeen : BOOL;
    startEdge : BOOL;
    stopEdge : BOOL;
    resetEdge : BOOL;
    entryEdge : BOOL;
    exitAEdge : BOOL;
    exitBEdge : BOOL;
    runoutEdge : BOOL;
    exitEdges : UINT;
    clearBeams : BOOL;
    readyToStart : BOOL;
    readyToResume : BOOL;
    observedExit : UINT;
    observedDisposition : UINT;
    tMotorStart : TON;
    tMotorLost : TON;
    tStop : TON;
    tStill : TON;
    tD1Extend : TON;
    tD2Extend : TON;
    tD1Home : TON;
    tD2Home : TON;
    tTransit : TON;
END_VAR
// Raw counter scaling stays inside the actual PLC, including UDINT rollover.
IF NOT initialized THEN
    encoderPrevious := I.Encoder_Count;
    speedStartUs := NowUs;
    initialized := TRUE;
END_IF;
IF I.Encoder_Count >= encoderPrevious THEN
    Q.EncoderDelta := I.Encoder_Count - encoderPrevious;
ELSE
    Q.EncoderDelta := ULINT_TO_UDINT(ULINT#4294967296 - UDINT_TO_ULINT(encoderPrevious)
        + UDINT_TO_ULINT(I.Encoder_Count));
END_IF;
encoderPrevious := I.Encoder_Count;
speedCounts := speedCounts + UDINT_TO_ULINT(Q.EncoderDelta);
Q.TravelMetres := Q.TravelMetres + UDINT_TO_LREAL(Q.EncoderDelta) / 1000.0;
IF NowUs - speedStartUs >= 100000 THEN
    Q.BeltSpeedMps := ULINT_TO_LREAL(speedCounts) * 1000.0 / ULINT_TO_LREAL(NowUs - speedStartUs);
    speedCounts := 0;
    speedStartUs := NowUs;
END_IF;
Q.ScanTimeUs := NowUs;

startEdge := StartSequence <> previousStart;
stopEdge := StopSequence <> previousStop;
resetEdge := ResetSequence <> previousReset;
previousStart := StartSequence;
previousStop := StopSequence;
previousReset := ResetSequence;
entryEdge := I.PE_Entry AND NOT prev.PE_Entry;
exitAEdge := I.PE_ExitA AND NOT prev.PE_ExitA;
exitBEdge := I.PE_ExitB AND NOT prev.PE_ExitB;
runoutEdge := I.PE_Runout AND NOT prev.PE_Runout;
exitEdges := BOOL_TO_UINT(exitAEdge) + BOOL_TO_UINT(exitBEdge) + BOOL_TO_UINT(runoutEdge);
clearBeams := NOT (I.PE_Entry OR I.PE_D1Approach OR I.PE_D2Approach
    OR I.PE_ExitA OR I.PE_ExitB OR I.PE_Runout);
Q.CompletionPending := Q.CompletionSequence <> CompletionAck;

// Offers use an immutable payload followed by a write-last sequence. Duplicate sequences do nothing.
IF (OfferSequence <> 0) AND (OfferSequence < previousOffer) THEN
    Q.OfferAckSequence := OfferSequence;
    Q.OfferAckItemId := OfferItemId;
    Q.OfferAccepted := FALSE;
    Q.OfferReason := 4; // stale/replayed sequence; never enqueue again
END_IF;
IF OfferSequence > previousOffer THEN
    previousOffer := OfferSequence;
    Q.OfferAckSequence := OfferSequence;
    Q.OfferAckItemId := OfferItemId;
    Q.OfferAccepted := FALSE;
    Q.OfferReason := 1; // busy/unavailable
    IF (OfferRoute > 2) OR (OfferItemId = 0) THEN
        Q.OfferReason := 2; // malformed
    ELSIF (Q.Mode <> 3) AND NOT Q.CompletionPending THEN
        IF Q.ItemActive THEN
            IF ((Q.ActiveItemId = 0) OR (Q.ActiveItemId = OfferItemId))
                AND ((Q.RequestedRoute = 0) OR (Q.RequestedRoute = OfferRoute)) THEN
                Q.ActiveItemId := OfferItemId;
                Q.RequestedRoute := OfferRoute;
                Q.OfferAccepted := TRUE;
                Q.OfferReason := 0;
            ELSE
                Q.OfferReason := 3; // conflicting identity/assignment
            END_IF;
        ELSIF NOT Q.OfferPending THEN
            pendingId := OfferItemId;
            pendingRoute := OfferRoute;
            Q.OfferPending := TRUE;
            Q.OfferAccepted := TRUE;
            Q.OfferReason := 0;
        END_IF;
    END_IF;
END_IF;

// Stop and Auto withdrawal both remove the run command in this scan.
IF stopEdge THEN Q.StopAck := StopSequence; END_IF;
IF (stopEdge OR NOT AutoRequest) AND (Q.Mode = 1) THEN Q.Mode := 2; END_IF;

readyToStart := NOT I.Drive_Overload
    AND I.D1_HomeFB AND NOT I.D1_ExtendedFB
    AND I.D2_HomeFB AND NOT I.D2_ExtendedFB
    AND I.Runout_Ready;
readyToResume := Q.ItemActive AND NOT I.Drive_Overload AND I.Runout_Ready
    AND ((I.D1_HomeFB AND NOT I.D1_ExtendedFB)
        OR ((Q.EffectiveRoute = 1) AND I.D1_ExtendedFB AND NOT I.D1_HomeFB))
    AND ((I.D2_HomeFB AND NOT I.D2_ExtendedFB)
        OR ((Q.EffectiveRoute = 2) AND I.D2_ExtendedFB AND NOT I.D2_HomeFB));
IF resetEdge THEN
    Q.ResetAck := ResetSequence;
    Q.ResetAccepted := FALSE;
    IF (Q.Mode <> 1) AND (Q.Mode <> 2) AND readyToStart
        AND NOT I.Drive_RunningFB AND clearBeams AND NOT Q.CompletionPending THEN
        Q.FaultCode := 0;
        Q.FaultText := '';
        Q.ExceptionCode := 0;
        Q.ExceptionText := '';
        Q.OfferPending := FALSE;
        Q.Mode := 0;
        runningSeen := FALSE;
        Q.ResetAccepted := TRUE;
    END_IF;
END_IF;
IF startEdge THEN
    Q.StartAck := StartSequence;
    Q.StartAccepted := FALSE;
    IF (Q.Mode = 0) AND AutoRequest AND (readyToStart OR readyToResume) AND NOT stopEdge
        AND NOT Q.CompletionPending AND (clearBeams OR Q.ItemActive) THEN
        Q.Mode := 1;
        runningSeen := FALSE;
        Q.StartAccepted := TRUE;
    END_IF;
END_IF;

// Accept one physical carton. A second carton is outside this baseline capacity.
IF entryEdge THEN
    IF Q.ItemActive OR Q.CompletionPending OR (Q.Mode <> 1) OR NOT I.Drive_RunningFB THEN
        Trip(Code := 30, Text := 'Unexpected entry / single-carton capacity exceeded');
    ELSE
        Q.ItemActive := TRUE;
        Q.ActiveItemId := 0;
        Q.RequestedRoute := 0;
        IF Q.OfferPending THEN
            Q.ActiveItemId := pendingId;
            Q.RequestedRoute := pendingRoute;
            Q.OfferPending := FALSE;
        END_IF;
        Q.EffectiveRoute := 0;
        Q.ActualExit := 0;
        Q.Disposition := 0;
        Q.ExceptionCode := 0;
        Q.ExceptionText := '';
        passedD1 := FALSE;
        passedD2 := FALSE;
    END_IF;
END_IF;

// Preposition as soon as an assignment exists. Each approach edge locks reachability.
IF Q.ItemActive THEN
    IF NOT passedD1 AND NOT passedD2 THEN
        Q.EffectiveRoute := 0;
        IF (Q.RequestedRoute = 1) AND I.ExitA_Ready THEN Q.EffectiveRoute := 1; END_IF;
        IF (Q.RequestedRoute = 2) AND I.ExitB_Ready THEN Q.EffectiveRoute := 2; END_IF;
    ELSIF NOT passedD2 AND (Q.EffectiveRoute <> 1) THEN
        Q.EffectiveRoute := 0;
        IF (Q.RequestedRoute = 2) AND I.ExitB_Ready THEN Q.EffectiveRoute := 2; END_IF;
    END_IF;
    IF I.PE_D1Approach AND NOT prev.PE_D1Approach THEN passedD1 := TRUE; END_IF;
    IF I.PE_D2Approach AND NOT prev.PE_D2Approach THEN passedD2 := TRUE; END_IF;
    IF (Q.RequestedRoute <> 0) AND (Q.EffectiveRoute = 0) THEN
        Q.ExceptionCode := 1;
        Q.ExceptionText := 'Assigned route unavailable or received too late; runout';
    END_IF;
END_IF;
Q.Motor_RunCmd := Q.Mode = 1;
Q.D1_ExtendCmd := Q.ItemActive AND (Q.EffectiveRoute = 1) AND (Q.Mode <> 3);
Q.D2_ExtendCmd := Q.ItemActive AND (Q.EffectiveRoute = 2) AND (Q.Mode <> 3);

IF (Q.Mode = 1) AND I.Drive_RunningFB THEN runningSeen := TRUE; END_IF;
tMotorStart(IN := (Q.Mode = 1) AND NOT runningSeen AND NOT I.Drive_RunningFB, PT := T#1500ms);
tMotorLost(IN := (Q.Mode = 1) AND runningSeen AND NOT I.Drive_RunningFB, PT := T#500ms);
tStill(IN := NOT I.Drive_RunningFB AND (Q.EncoderDelta = 0), PT := T#200ms);
tStop(IN := (Q.Mode = 2) AND NOT tStill.Q, PT := T#4s);
tD1Extend(IN := Q.D1_ExtendCmd AND NOT I.D1_ExtendedFB, PT := T#1200ms);
tD2Extend(IN := Q.D2_ExtendCmd AND NOT I.D2_ExtendedFB, PT := T#1200ms);
tD1Home(IN := (Q.Mode = 1 OR Q.Mode = 2) AND NOT Q.D1_ExtendCmd AND NOT I.D1_HomeFB, PT := T#1200ms);
tD2Home(IN := (Q.Mode = 1 OR Q.Mode = 2) AND NOT Q.D2_ExtendCmd AND NOT I.D2_HomeFB, PT := T#1200ms);
tTransit(IN := Q.ItemActive AND (Q.Mode = 1), PT := T#30s);

// Machine faults take priority over exit success in the same scan.
IF I.Drive_Overload THEN Trip(Code := 10, Text := 'Drive overload'); END_IF;
IF I.D1_HomeFB AND I.D1_ExtendedFB THEN Trip(Code := 21, Text := 'D1 contradictory limits'); END_IF;
IF I.D2_HomeFB AND I.D2_ExtendedFB THEN Trip(Code := 22, Text := 'D2 contradictory limits'); END_IF;
IF tMotorStart.Q THEN Trip(Code := 11, Text := 'Motor running feedback missing on start'); END_IF;
IF tMotorLost.Q THEN Trip(Code := 12, Text := 'Motor running feedback lost'); END_IF;
IF tStop.Q THEN Trip(Code := 13, Text := 'Motor failed to stop within 4 seconds'); END_IF;
IF tD1Extend.Q THEN Trip(Code := 23, Text := 'D1 extend feedback timeout'); END_IF;
IF tD2Extend.Q THEN Trip(Code := 24, Text := 'D2 extend feedback timeout'); END_IF;
IF tD1Home.Q THEN Trip(Code := 25, Text := 'D1 home feedback timeout'); END_IF;
IF tD2Home.Q THEN Trip(Code := 26, Text := 'D2 home feedback timeout'); END_IF;
IF tTransit.Q THEN Trip(Code := 33, Text := 'Carton transit timeout'); END_IF;
IF (Q.Mode = 1) AND NOT I.Runout_Ready THEN Trip(Code := 34, Text := 'Runout unavailable; conveyor stopped'); END_IF;
IF exitEdges > 1 THEN Trip(Code := 31, Text := 'Multiple exit edges for single carton'); END_IF;
IF (exitEdges = 1) AND (Q.Mode <> 3) THEN
    IF Q.ItemActive THEN
        observedExit := 3;
        IF exitAEdge THEN observedExit := 1; END_IF;
        IF exitBEdge THEN observedExit := 2; END_IF;
        observedDisposition := 3; // misroute
        IF Q.RequestedRoute = observedExit THEN observedDisposition := 1; END_IF;
        IF (Q.RequestedRoute = 0) AND (observedExit = 3) THEN observedDisposition := 2; END_IF;
        IF (observedDisposition = 1) AND
            (((observedExit = 1) AND (NOT I.D1_ExtendedFB OR I.D1_HomeFB))
            OR ((observedExit = 2) AND (NOT I.D2_ExtendedFB OR I.D2_HomeFB))) THEN
            Trip(Code := 27, Text := 'Assigned exit observed without verified divert position');
        ELSE
            Finish(Actual := observedExit, Result := observedDisposition);
        END_IF;
    ELSE
        Trip(Code := 32, Text := 'Exit without an active tracked carton');
    END_IF;
END_IF;

IF (Q.Mode = 2) AND tStill.Q THEN Q.Mode := 0; END_IF;
IF Q.Mode <> 1 THEN Q.Motor_RunCmd := FALSE; END_IF;
IF NOT Q.ItemActive OR (Q.Mode = 3) THEN
    Q.D1_ExtendCmd := FALSE;
    Q.D2_ExtendCmd := FALSE;
END_IF;
Q.CompletionPending := Q.CompletionSequence <> CompletionAck;
Q.ReleaseReady := (Q.Mode = 1) AND I.Drive_RunningFB
    AND NOT Q.ItemActive AND NOT Q.CompletionPending AND clearBeams
    AND I.D1_HomeFB AND NOT I.D1_ExtendedFB AND I.D2_HomeFB AND NOT I.D2_ExtendedFB
    AND I.Runout_Ready;
Q.StackLight_Red := Q.Mode = 3;
Q.StackLight_Green := Q.Mode = 1;
CASE Q.Mode OF
    0: Q.ModeText := 'Stopped';
    1: Q.ModeText := 'Auto';
    2: Q.ModeText := 'Stopping';
    3: Q.ModeText := 'Faulted';
END_CASE;
prev := I;

METHOD PRIVATE Finish
VAR_INPUT
    Actual : UINT;
    Result : UINT;
END_VAR
IF Q.ItemActive THEN
    Q.ActualExit := Actual;
    Q.Disposition := Result;
    Q.CompletionSequence := Q.CompletionSequence + 1;
    Q.CompletionItemId := Q.ActiveItemId;
    Q.CompletionRoute := Q.RequestedRoute;
    Q.CompletionExit := Actual;
    Q.CompletionDisposition := Result;
    CASE Actual OF
        1: Q.CountExitA := Q.CountExitA + 1;
        2: Q.CountExitB := Q.CountExitB + 1;
        3: Q.CountRunout := Q.CountRunout + 1;
    END_CASE;
    IF Result = 3 THEN
        Q.CountMisroute := Q.CountMisroute + 1;
        Q.ExceptionCode := 2;
        Q.ExceptionText := 'Misroute: observed exit differs from requested route';
    END_IF;
    IF Result = 4 THEN Q.CountFaulted := Q.CountFaulted + 1; END_IF;
    Q.ItemActive := FALSE;
END_IF;
END_METHOD

METHOD PRIVATE Trip
VAR_INPUT
    Code : UINT;
    Text : STRING(80);
END_VAR
IF Q.Mode <> 3 THEN
    Q.FaultCode := Code;
    Q.FaultText := Text;
    Q.Mode := 3;
    Finish(Actual := 0, Result := 4);
END_IF;
END_METHOD
END_FUNCTION_BLOCK
