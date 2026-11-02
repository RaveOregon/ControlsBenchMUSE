FUNCTION_BLOCK FB_CB_Session
VAR_INPUT
    Hardware : ST_CB_Image; // raw values packed by the machine mapping, unchanged
    Config : ST_CB_Config; // pinned at initialization; any later change latches ReconfigureRequired
    NowUs : ULINT; // monotonic microseconds from a platform service
    BootId : ULINT; // nonzero platform identity that changes on every application or runtime restart
    Reinitialize : BOOL; // rising edge from local application authority, never from the workstation
END_VAR
VAR_IN_OUT
    Request : ST_CB_Request; // storage owned by this domain; exactly one workstation writer
END_VAR
VAR_OUTPUT
    Image : ST_CB_Image; // complete image the application consumes this cycle
    Status : ST_CB_Status;
END_VAR
VAR
    initialized : BOOL;
    previousSim : BOOL;
    previousSessionReset : BOOL;
    previousSimulationReset : BOOL;
    previousReinitialize : BOOL;
    haveHeartbeat : BOOL;
    previousHeartbeat : ULINT;
    lastHeartbeatUs : ULINT;
    lastTimeUs : ULINT;
    lastRequestSequence : ULINT;
    active : ST_CB_Image;
    zero : ST_CB_Image;
    pinned : ST_CB_Config;
    slot : ST_CB_Slot;
    reqSim : BOOL;
    reqSessionReset : BOOL;
    reqSimulationReset : BOOL;
    reqHeartbeat : ULINT;
    reqSlot : USINT;
    reqEpoch : ULINT;
    reqSequence : ULINT;
    reinitializeEdge : BOOL;
    entryEdge : BOOL;
    sessionResetEdge : BOOL;
    simulationResetEdge : BOOL;
    commitEdge : BOOL;
    configChanged : BOOL;
    blocked : BOOL;
    blockedResult : UINT;
    staleAtEntry : BOOL;
    accept : BOOL;
    consumed : BOOL;
    result : UINT;
    rejectBank : USINT;
    rejectIndex : UINT;
    i : UINT;
    di : FB_CB_DI;
    ai : FB_CB_AI;
END_VAR
// Read each request word once so every decision in this cycle uses the same values.
reqSim := Request.SimRequest;
reqSessionReset := Request.SessionResetRequest;
reqSimulationReset := Request.SimulationResetRequest;
reqHeartbeat := Request.Heartbeat;
reqSlot := Request.RequestedSlot;
reqEpoch := Request.RequestedEpoch;
reqSequence := Request.RequestedSequence;
consumed := FALSE;
result := GVL_CB.RESULT_NONE;
reinitializeEdge := Reinitialize AND NOT previousReinitialize;
previousReinitialize := Reinitialize;
Status.Cycle := Status.Cycle + 1;
Status.TimeUs := NowUs;

IF NOT initialized OR reinitializeEdge THEN
    // A fresh domain pins configuration and boot identity, holds raw zero and
    // consumes whatever is staged; a heartbeat must change before the link is fresh.
    pinned := Config;
    Status.BootIdentity := BootId;
    Status.ReconfigureRequired := FALSE;
    active := zero;
    Status.ActiveSlot := GVL_CB.NO_SLOT;
    Status.AppliedEpoch := 0;
    Status.AppliedSequence := 0;
    Status.AppliedCycle := Status.Cycle;
    Status.AppliedTimeUs := NowUs;
    lastTimeUs := NowUs;
    lastRequestSequence := reqSequence;
    previousHeartbeat := reqHeartbeat;
    haveHeartbeat := FALSE;
    IF initialized THEN
        previousSim := reqSim; // a simulated domain stays simulated, now at raw zero
        Status.ReinitializeCount := Status.ReinitializeCount + 1;
        consumed := TRUE;
        result := GVL_CB.RESULT_REINITIALIZED;
    END_IF;
    initialized := TRUE;
END_IF;
Status.DomainId := pinned.DomainId;
Status.SchemaId := pinned.SchemaId;

// Configuration validity: identities, capacities and declared native widths.
Status.ConfigValid := (Config.DomainId <> 0) AND (Config.SchemaId <> 0) AND (Config.TimeoutUs > 0)
    AND (Config.DigitalCount <= GVL_CB.DIGITAL_CAPACITY) AND (Config.SignedCount <= GVL_CB.SIGNED_CAPACITY)
    AND (Config.UnsignedCount <= GVL_CB.UNSIGNED_CAPACITY) AND (Config.RealCount <= GVL_CB.REAL_CAPACITY)
    AND (BootId <> 0);
configChanged := (Config.DomainId <> pinned.DomainId) OR (Config.SchemaId <> pinned.SchemaId)
    OR (Config.TimeoutUs <> pinned.TimeoutUs) OR (Config.DigitalCount <> pinned.DigitalCount)
    OR (Config.SignedCount <> pinned.SignedCount) OR (Config.UnsignedCount <> pinned.UnsignedCount)
    OR (Config.RealCount <> pinned.RealCount);
FOR i := 0 TO 31 DO
    IF (i < Config.SignedCount) AND NOT ((Config.SignedBits[i] = 8) OR (Config.SignedBits[i] = 16)
        OR (Config.SignedBits[i] = 32)) THEN
        Status.ConfigValid := FALSE;
    END_IF;
    IF (i < Config.UnsignedCount) AND ((Config.UnsignedBits[i] = 0) OR (Config.UnsignedBits[i] > 32)) THEN
        Status.ConfigValid := FALSE;
    END_IF;
    IF (Config.SignedBits[i] <> pinned.SignedBits[i]) OR (Config.UnsignedBits[i] <> pinned.UnsignedBits[i]) THEN
        configChanged := TRUE;
    END_IF;
END_FOR;
FOR i := 0 TO 15 DO
    IF Config.RealNonFiniteAllowed[i] <> pinned.RealNonFiniteAllowed[i] THEN
        configChanged := TRUE;
    END_IF;
END_FOR;
Status.ClockValid := NowUs >= lastTimeUs;
IF configChanged OR (BootId <> Status.BootIdentity) OR NOT Status.ClockValid THEN
    Status.ReconfigureRequired := TRUE; // no hidden remapping; Reinitialize explicitly
END_IF;
blocked := NOT Status.ConfigValid OR Status.ReconfigureRequired;
IF Status.ReconfigureRequired THEN
    blockedResult := GVL_CB.RESULT_RECONFIGURE_REQUIRED;
ELSE
    blockedResult := GVL_CB.RESULT_CONFIG_INVALID;
END_IF;

// Link freshness uses elapsed microseconds, independent of the task period.
// Staleness at cycle entry is evaluated before this cycle's heartbeat is applied.
staleAtEntry := NOT haveHeartbeat OR (NowUs < lastHeartbeatUs)
    OR ((NowUs - lastHeartbeatUs) > pinned.TimeoutUs);
IF reqHeartbeat <> previousHeartbeat THEN
    previousHeartbeat := reqHeartbeat;
    lastHeartbeatUs := NowUs;
    haveHeartbeat := TRUE;
    Status.LastHeartbeat := reqHeartbeat;
    Status.LastHeartbeatTimeUs := NowUs;
END_IF;
Status.ConnectorStale := NOT haveHeartbeat OR (NowUs < lastHeartbeatUs)
    OR ((NowUs - lastHeartbeatUs) > pinned.TimeoutUs);

entryEdge := reqSim AND NOT previousSim;
previousSim := reqSim;
sessionResetEdge := reqSessionReset AND NOT previousSessionReset;
previousSessionReset := reqSessionReset;
simulationResetEdge := reqSimulationReset AND NOT previousSimulationReset;
previousSimulationReset := reqSimulationReset;
commitEdge := reqSequence <> lastRequestSequence;

IF entryEdge THEN
    // Entry gives the workstation complete input authority at raw zero.
    // Staged data never applies on entry; complete commits establish normal conditions.
    active := zero;
    Status.ActiveSlot := GVL_CB.NO_SLOT;
    Status.AppliedEpoch := 0;
    Status.AppliedSequence := 0;
    Status.AppliedCycle := Status.Cycle;
    Status.AppliedTimeUs := NowUs;
    Status.SimulationEntryCount := Status.SimulationEntryCount + 1;
    consumed := TRUE;
    result := GVL_CB.RESULT_SIMULATION_ENTRY;
    lastRequestSequence := reqSequence;
    commitEdge := FALSE;
END_IF;

IF simulationResetEdge OR sessionResetEdge THEN
    // Neither reset requests a machine Reset or leaves simulation.
    IF blocked THEN
        Status.BlockedRequestCount := Status.BlockedRequestCount + 1;
        result := blockedResult;
    ELSE
        IF simulationResetEdge THEN
            active := zero; // explicit simulation reset: raw zero, still simulated
            Status.SimulationResetCount := Status.SimulationResetCount + 1;
            result := GVL_CB.RESULT_SIMULATION_RESET;
        END_IF;
        IF sessionResetEdge THEN
            Status.SessionResetCount := Status.SessionResetCount + 1; // image retained
            IF NOT simulationResetEdge THEN
                result := GVL_CB.RESULT_SESSION_RESET;
            END_IF;
        END_IF;
        Status.ActiveSlot := GVL_CB.NO_SLOT;
        Status.AppliedEpoch := 0;
        Status.AppliedSequence := 0;
        Status.AppliedCycle := Status.Cycle;
        Status.AppliedTimeUs := NowUs;
    END_IF;
    consumed := TRUE;
    lastRequestSequence := reqSequence; // the staged request is consumed without applying
    commitEdge := FALSE;
END_IF;

IF commitEdge THEN
    // RequestedSequence, written last, is the single commit edge. Each edge is consumed once.
    consumed := TRUE;
    accept := FALSE;
    rejectBank := GVL_CB.BANK_NONE;
    rejectIndex := 0;
    IF blocked THEN
        Status.BlockedRequestCount := Status.BlockedRequestCount + 1;
        result := blockedResult;
    ELSIF NOT reqSim THEN
        Status.NotSimulatedCount := Status.NotSimulatedCount + 1;
        result := GVL_CB.RESULT_NOT_SIMULATED;
    ELSIF (reqEpoch = 0) AND (reqSequence = 0) THEN
        Status.IdleClearCount := Status.IdleClearCount + 1;
        result := GVL_CB.RESULT_IDLE_CLEARED;
    ELSIF (reqSlot > 1) OR (reqSlot = Status.ActiveSlot) THEN
        Status.InvalidSlotCount := Status.InvalidSlotCount + 1;
        result := GVL_CB.RESULT_INVALID_SLOT;
    ELSE
        slot := Request.Slots[reqSlot];
        IF NOT slot.Valid OR (slot.Epoch = 0) OR (slot.Sequence = 0) THEN
            Status.IncompleteSlotCount := Status.IncompleteSlotCount + 1;
            result := GVL_CB.RESULT_INCOMPLETE_SLOT;
        ELSIF (slot.DomainId <> pinned.DomainId) OR (slot.SchemaId <> pinned.SchemaId)
            OR (slot.Epoch <> reqEpoch) OR (slot.Sequence <> reqSequence) THEN
            Status.MetadataMismatchCount := Status.MetadataMismatchCount + 1;
            result := GVL_CB.RESULT_METADATA_MISMATCH;
        ELSE
            result := F_CB_CheckImage(Image := slot.Data, Config := pinned, Bank => rejectBank, Index => rejectIndex);
            IF result <> GVL_CB.RESULT_NONE THEN
                Status.RepresentationRejectedCount := Status.RepresentationRejectedCount + 1;
            ELSIF Status.AppliedEpoch = 0 THEN
                accept := TRUE;
            ELSIF slot.Epoch = Status.AppliedEpoch THEN
                IF slot.Sequence = Status.AppliedSequence THEN
                    Status.DuplicateCount := Status.DuplicateCount + 1;
                    result := GVL_CB.RESULT_DUPLICATE;
                ELSIF slot.Sequence < Status.AppliedSequence THEN
                    Status.StaleCount := Status.StaleCount + 1;
                    result := GVL_CB.RESULT_STALE;
                ELSE
                    IF slot.Sequence - Status.AppliedSequence > 1 THEN
                        Status.SkippedCount := Status.SkippedCount + 1;
                    END_IF;
                    accept := TRUE;
                END_IF;
            ELSIF staleAtEntry THEN
                accept := TRUE; // a new epoch only after elapsed staleness or an explicit reset
            ELSE
                Status.EpochRejectedCount := Status.EpochRejectedCount + 1;
                result := GVL_CB.RESULT_EPOCH_REJECTED;
            END_IF;
        END_IF;
    END_IF;
    IF accept THEN
        active := slot.Data; // every bank changes together; no torn image
        Status.ActiveSlot := reqSlot;
        Status.AppliedEpoch := slot.Epoch;
        Status.AppliedSequence := slot.Sequence;
        Status.AppliedCycle := Status.Cycle;
        Status.AppliedTimeUs := NowUs;
        Status.CommitCount := Status.CommitCount + 1;
        result := GVL_CB.RESULT_ACCEPTED;
    END_IF;
    Status.RejectBank := rejectBank;
    Status.RejectIndex := rejectIndex;
    lastRequestSequence := reqSequence;
END_IF;

IF consumed THEN
    Status.ConsumedEpoch := reqEpoch;
    Status.ConsumedSequence := reqSequence;
    Status.ConsumedSlot := reqSlot;
    Status.ConsumedResult := result;
    Status.ConsumedCycle := Status.Cycle;
    Status.ConsumedTimeUs := NowUs;
END_IF;

// Exit Simulation (SimRequest FALSE) is always honoured. Bad configuration while
// simulated holds the image; it never silently selects hardware.
Status.SimApplied := reqSim;
di(Hardware := Hardware.Digital, Simulated := active.Digital, SimApplied := reqSim);
ai(Hardware := Hardware.Numeric, Simulated := active.Numeric, SimApplied := reqSim);
Image.Digital := di.Selected;
Image.Numeric := ai.Selected;
lastTimeUs := NowUs;
END_FUNCTION_BLOCK