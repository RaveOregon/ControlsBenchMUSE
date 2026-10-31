FUNCTION_BLOCK FB_BenchIntercept
VAR_INPUT
    Hardware : ST_BenchInputImage;
END_VAR
VAR_OUTPUT
    Image : ST_BenchInputImage;
END_VAR
VAR
    previousSim : BOOL;
    simulationEntry : BOOL;
    ActiveImage : ST_BenchInputImage;
    CandidateImage : ST_BenchInputImage;
    ZeroImage : ST_BenchInputImage;

    initialized : BOOL := FALSE;
    haveHeartbeat : BOOL := FALSE;
    previousSessionReset : BOOL := FALSE;
    lastWorkstationHeartbeat : ULINT := 0;
    lastHeartbeatCycle : ULINT := 0;

    lastRequestSequence : ULINT := 0;

    requestChanged : BOOL;
    sessionResetEdge : BOOL;
    slotIsInactive : BOOL;
    slotValid : BOOL;
    slotEpoch : ULINT;
    slotSequence : ULINT;
    acceptCommit : BOOL;
    payloadPhysicalValid : BOOL;

    nowUs : SysTimeCore.SYSTIME;
    timeResult : UDINT;
END_VAR
// Capture monotonic PLC time and advance scan-owned liveness.
timeResult := SysTimeCore.SysTimeGetUs(nowUs);
GVL_BenchRead.PlcTimeUs := nowUs;
GVL_BenchRead.PlcCycle := GVL_BenchRead.PlcCycle + 1;
GVL_BenchRead.PlcHeartbeat := GVL_BenchRead.PlcHeartbeat + 1;

IF NOT initialized THEN
    GVL_BenchRead.PlcBootIdentity := nowUs;
    IF GVL_BenchRead.PlcBootIdentity = 0 THEN
        GVL_BenchRead.PlcBootIdentity := 1;
    END_IF;
    GVL_BenchRead.ActiveSlot := 255;
    ActiveImage := ZeroImage;
    initialized := TRUE;
END_IF;

// Hardware passthrough is the cold-start default. Entering simulation zeros all raw types.
simulationEntry := GVL_BenchWrite.SimRequest AND NOT previousSim;
previousSim := GVL_BenchWrite.SimRequest;
GVL_BenchRead.SimApplied := GVL_BenchWrite.SimRequest;
IF simulationEntry THEN
    ActiveImage := ZeroImage;
    GVL_BenchRead.AppliedEpoch := 0;
    GVL_BenchRead.AppliedSequence := 0;
    GVL_BenchRead.ActiveSlot := 255;
    lastRequestSequence := GVL_BenchWrite.RequestedSequence;
END_IF;

// Heartbeat freshness is independent of commit traffic.
// 25 scans at the current 20 ms task interval equals the 500 ms M5 floor.
IF GVL_BenchWrite.WorkstationHeartbeat <> lastWorkstationHeartbeat THEN
    lastWorkstationHeartbeat := GVL_BenchWrite.WorkstationHeartbeat;
    lastHeartbeatCycle := GVL_BenchRead.PlcCycle;
    haveHeartbeat := TRUE;
END_IF;

IF haveHeartbeat THEN
    GVL_BenchRead.ConnectorStale :=
        (GVL_BenchRead.PlcCycle - lastHeartbeatCycle) > 25;
ELSE
    GVL_BenchRead.ConnectorStale := TRUE;
END_IF;

// A rising session reset explicitly clears epoch continuity and the active image.
sessionResetEdge :=
    GVL_BenchWrite.SessionResetRequest AND NOT previousSessionReset;
previousSessionReset := GVL_BenchWrite.SessionResetRequest;

IF sessionResetEdge THEN
    GVL_BenchRead.AppliedEpoch := 0;
    GVL_BenchRead.AppliedSequence := 0;
    GVL_BenchRead.ActiveSlot := 255;
    ActiveImage := ZeroImage;
    lastRequestSequence := GVL_BenchWrite.RequestedSequence;
    GVL_BenchRead.SessionResetCount :=
        GVL_BenchRead.SessionResetCount + 1;
END_IF;

// RequestedSequence is the single commit edge and is written after the complete valid slot.
requestChanged := GVL_BenchWrite.RequestedSequence <> lastRequestSequence;

IF GVL_BenchRead.SimApplied
    AND NOT sessionResetEdge
    AND requestChanged
    AND ((GVL_BenchWrite.RequestedEpoch <> 0)
        OR (GVL_BenchWrite.RequestedSequence <> 0)) THEN

    acceptCommit := FALSE;
    slotValid := FALSE;
    slotEpoch := 0;
    slotSequence := 0;

    IF GVL_BenchWrite.RequestedSlot > 1 THEN
        GVL_BenchRead.InvalidSlotCount :=
            GVL_BenchRead.InvalidSlotCount + 1;
    ELSE
        slotIsInactive :=
            (GVL_BenchRead.ActiveSlot = 255)
            OR (GVL_BenchWrite.RequestedSlot <> GVL_BenchRead.ActiveSlot);

        IF NOT slotIsInactive THEN
            GVL_BenchRead.InvalidSlotCount :=
                GVL_BenchRead.InvalidSlotCount + 1;
        ELSE
            IF GVL_BenchWrite.RequestedSlot = 0 THEN
                slotValid := GVL_BenchWrite.Slot0_Valid;
                slotEpoch := GVL_BenchWrite.Slot0_Epoch;
                slotSequence := GVL_BenchWrite.Slot0_Sequence;

                CandidateImage.PE_Entry := GVL_BenchWrite.Slot0_PE_Entry;
                CandidateImage.PE_D1Approach := GVL_BenchWrite.Slot0_PE_D1Approach;
                CandidateImage.PE_D2Approach := GVL_BenchWrite.Slot0_PE_D2Approach;
                CandidateImage.PE_ExitA := GVL_BenchWrite.Slot0_PE_ExitA;
                CandidateImage.PE_ExitB := GVL_BenchWrite.Slot0_PE_ExitB;
                CandidateImage.PE_Runout := GVL_BenchWrite.Slot0_PE_Runout;
                CandidateImage.D1_HomeFB := GVL_BenchWrite.Slot0_D1_HomeFB;
                CandidateImage.D1_ExtendedFB := GVL_BenchWrite.Slot0_D1_ExtendedFB;
                CandidateImage.D2_HomeFB := GVL_BenchWrite.Slot0_D2_HomeFB;
                CandidateImage.D2_ExtendedFB := GVL_BenchWrite.Slot0_D2_ExtendedFB;
                CandidateImage.Drive_RunningFB := GVL_BenchWrite.Slot0_Drive_RunningFB;
                CandidateImage.Drive_Overload := GVL_BenchWrite.Slot0_Drive_Overload;
                CandidateImage.ExitA_Ready := GVL_BenchWrite.Slot0_ExitA_Ready;
                CandidateImage.ExitB_Ready := GVL_BenchWrite.Slot0_ExitB_Ready;
                CandidateImage.Runout_Ready := GVL_BenchWrite.Slot0_Runout_Ready;
                CandidateImage.Belt_SpeedActual := GVL_BenchWrite.Slot0_Belt_SpeedActual;
                CandidateImage.Drive_Current := GVL_BenchWrite.Slot0_Drive_Current;
                CandidateImage.D1_Position := GVL_BenchWrite.Slot0_D1_Position;
                CandidateImage.D2_Position := GVL_BenchWrite.Slot0_D2_Position;
                CandidateImage.Encoder_Count := GVL_BenchWrite.Slot0_Encoder_Count;
            ELSE
                slotValid := GVL_BenchWrite.Slot1_Valid;
                slotEpoch := GVL_BenchWrite.Slot1_Epoch;
                slotSequence := GVL_BenchWrite.Slot1_Sequence;

                CandidateImage.PE_Entry := GVL_BenchWrite.Slot1_PE_Entry;
                CandidateImage.PE_D1Approach := GVL_BenchWrite.Slot1_PE_D1Approach;
                CandidateImage.PE_D2Approach := GVL_BenchWrite.Slot1_PE_D2Approach;
                CandidateImage.PE_ExitA := GVL_BenchWrite.Slot1_PE_ExitA;
                CandidateImage.PE_ExitB := GVL_BenchWrite.Slot1_PE_ExitB;
                CandidateImage.PE_Runout := GVL_BenchWrite.Slot1_PE_Runout;
                CandidateImage.D1_HomeFB := GVL_BenchWrite.Slot1_D1_HomeFB;
                CandidateImage.D1_ExtendedFB := GVL_BenchWrite.Slot1_D1_ExtendedFB;
                CandidateImage.D2_HomeFB := GVL_BenchWrite.Slot1_D2_HomeFB;
                CandidateImage.D2_ExtendedFB := GVL_BenchWrite.Slot1_D2_ExtendedFB;
                CandidateImage.Drive_RunningFB := GVL_BenchWrite.Slot1_Drive_RunningFB;
                CandidateImage.Drive_Overload := GVL_BenchWrite.Slot1_Drive_Overload;
                CandidateImage.ExitA_Ready := GVL_BenchWrite.Slot1_ExitA_Ready;
                CandidateImage.ExitB_Ready := GVL_BenchWrite.Slot1_ExitB_Ready;
                CandidateImage.Runout_Ready := GVL_BenchWrite.Slot1_Runout_Ready;
                CandidateImage.Belt_SpeedActual := GVL_BenchWrite.Slot1_Belt_SpeedActual;
                CandidateImage.Drive_Current := GVL_BenchWrite.Slot1_Drive_Current;
                CandidateImage.D1_Position := GVL_BenchWrite.Slot1_D1_Position;
                CandidateImage.D2_Position := GVL_BenchWrite.Slot1_D2_Position;
                CandidateImage.Encoder_Count := GVL_BenchWrite.Slot1_Encoder_Count;
            END_IF;

            // Generous fixture limits reject NaN, infinity, and physically invalid negatives.
            payloadPhysicalValid :=
                (CandidateImage.Belt_SpeedActual >= 0.0)
                AND (CandidateImage.Belt_SpeedActual <= 100.0)
                AND (CandidateImage.Drive_Current >= 0.0)
                AND (CandidateImage.Drive_Current <= 10000.0)
                AND (CandidateImage.D1_Position >= 0.0)
                AND (CandidateImage.D1_Position <= 100.0)
                AND (CandidateImage.D2_Position >= 0.0)
                AND (CandidateImage.D2_Position <= 100.0);

            IF NOT slotValid THEN
                GVL_BenchRead.InvalidPayloadCount :=
                    GVL_BenchRead.InvalidPayloadCount + 1;
            ELSIF NOT payloadPhysicalValid THEN
                GVL_BenchRead.InvalidPayloadCount :=
                    GVL_BenchRead.InvalidPayloadCount + 1;
            ELSIF (slotEpoch = 0) OR (slotSequence = 0) THEN
                GVL_BenchRead.InvalidPayloadCount :=
                    GVL_BenchRead.InvalidPayloadCount + 1;
            ELSIF (slotEpoch <> GVL_BenchWrite.RequestedEpoch)
                OR (slotSequence <> GVL_BenchWrite.RequestedSequence) THEN
                GVL_BenchRead.SlotMetadataMismatchCount :=
                    GVL_BenchRead.SlotMetadataMismatchCount + 1;
            ELSIF GVL_BenchRead.AppliedEpoch = 0 THEN
                acceptCommit := TRUE;
            ELSIF slotEpoch = GVL_BenchRead.AppliedEpoch THEN
                IF slotSequence = GVL_BenchRead.AppliedSequence THEN
                    GVL_BenchRead.DuplicateCommitCount :=
                        GVL_BenchRead.DuplicateCommitCount + 1;
                ELSIF slotSequence < GVL_BenchRead.AppliedSequence THEN
                    GVL_BenchRead.StaleCommitCount :=
                        GVL_BenchRead.StaleCommitCount + 1;
                ELSE
                    IF slotSequence > (GVL_BenchRead.AppliedSequence + 1) THEN
                        GVL_BenchRead.SkippedSequenceCount :=
                            GVL_BenchRead.SkippedSequenceCount + 1;
                    END_IF;
                    acceptCommit := TRUE;
                END_IF;
            ELSIF GVL_BenchRead.ConnectorStale OR sessionResetEdge THEN
                // A new random workstation epoch is allowed only after stale or explicit reset.
                acceptCommit := TRUE;
            ELSE
                GVL_BenchRead.EpochRejectedCount :=
                    GVL_BenchRead.EpochRejectedCount + 1;
            END_IF;

            IF acceptCommit THEN
                // Same-task scan-owned publication: downstream logic sees one complete revision.
                ActiveImage := CandidateImage;
                GVL_BenchRead.ActiveSlot := GVL_BenchWrite.RequestedSlot;
                GVL_BenchRead.AppliedEpoch := slotEpoch;
                GVL_BenchRead.AppliedSequence := slotSequence;
                GVL_BenchRead.AppliedCaptureCycle := GVL_BenchRead.PlcCycle;
                GVL_BenchRead.AppliedCaptureTimeUs := GVL_BenchRead.PlcTimeUs;
                GVL_BenchRead.AppliedCommitCount :=
                    GVL_BenchRead.AppliedCommitCount + 1;
            END_IF;
        END_IF;
    END_IF;

END_IF;

IF requestChanged THEN
    lastRequestSequence := GVL_BenchWrite.RequestedSequence;
END_IF;

// Select the complete image before any application logic executes.
IF GVL_BenchRead.SimApplied THEN
    Image := ActiveImage;
ELSE
    Image := Hardware;
END_IF;
// Publish the selected application-visible raw image for verification.
GVL_BenchRead.Active_PE_Entry := Image.PE_Entry;
GVL_BenchRead.Active_PE_D1Approach := Image.PE_D1Approach;
GVL_BenchRead.Active_PE_D2Approach := Image.PE_D2Approach;
GVL_BenchRead.Active_PE_ExitA := Image.PE_ExitA;
GVL_BenchRead.Active_PE_ExitB := Image.PE_ExitB;
GVL_BenchRead.Active_PE_Runout := Image.PE_Runout;
GVL_BenchRead.Active_D1_HomeFB := Image.D1_HomeFB;
GVL_BenchRead.Active_D1_ExtendedFB := Image.D1_ExtendedFB;
GVL_BenchRead.Active_D2_HomeFB := Image.D2_HomeFB;
GVL_BenchRead.Active_D2_ExtendedFB := Image.D2_ExtendedFB;
GVL_BenchRead.Active_Drive_RunningFB := Image.Drive_RunningFB;
GVL_BenchRead.Active_Drive_Overload := Image.Drive_Overload;
GVL_BenchRead.Active_ExitA_Ready := Image.ExitA_Ready;
GVL_BenchRead.Active_ExitB_Ready := Image.ExitB_Ready;
GVL_BenchRead.Active_Runout_Ready := Image.Runout_Ready;
GVL_BenchRead.Active_Belt_SpeedActual := Image.Belt_SpeedActual;
GVL_BenchRead.Active_Drive_Current := Image.Drive_Current;
GVL_BenchRead.Active_D1_Position := Image.D1_Position;
GVL_BenchRead.Active_D2_Position := Image.D2_Position;
GVL_BenchRead.Active_Encoder_Count := Image.Encoder_Count;
END_FUNCTION_BLOCK
