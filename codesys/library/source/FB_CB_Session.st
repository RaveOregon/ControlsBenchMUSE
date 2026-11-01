FUNCTION_BLOCK FB_CB_Session
VAR_INPUT
    Hardware : ST_CB_Image;
    Config : ST_CB_Config;
    NowUs : ULINT; // monotonic clock supplied by platform adapter
    BootId : ULINT; // nonzero boot identity supplied by platform adapter
END_VAR
VAR_IN_OUT
    Request : ST_CB_Request; // explicit storage owned by this domain
END_VAR
VAR_OUTPUT
    Image : ST_CB_Image;
    Status : ST_CB_Status;
END_VAR
VAR
    initialized : BOOL;
    previousSim : BOOL;
    previousReset : BOOL;
    previousSimulationReset : BOOL;
    haveHeartbeat : BOOL;
    previousHeartbeat : ULINT;
    lastHeartbeatUs : ULINT;
    lastTimeUs : ULINT;
    lastRequestSequence : ULINT;
    active : ST_CB_Image;
    zero : ST_CB_Image;
    slot : ST_CB_Slot;
    pinnedConfig : ST_CB_Config;
    validConfig : BOOL;
    resetEdge : BOOL;
    simulationResetEdge : BOOL;
    commitChanged : BOOL;
    accept : BOOL;
    staleAtScanEntry : BOOL;
    di : FB_CB_DI;
    ai : FB_CB_AI;
END_VAR
IF NOT initialized THEN
    Status.BootIdentity := BootId;
    Status.ActiveSlot := 255;
    pinnedConfig := Config;
    initialized := TRUE;
    lastTimeUs := NowUs;
END_IF;
Status.Cycle := Status.Cycle + 1;
Status.TimeUs := NowUs;
Status.DomainId := pinnedConfig.DomainId;
Status.SchemaId := pinnedConfig.SchemaId;
Status.LastResult := 0;
validConfig := (Config.DomainId <> 0) AND (Config.SchemaId <> 0)
    AND (Config.TimeoutUs > 0) AND (Config.DigitalCount <= 64)
    AND (Config.SignedCount <= 32) AND (Config.UnsignedCount <= 32)
    AND (Config.RealCount <= 16) AND (BootId <> 0);
Status.ConfigValid := validConfig;
Status.ClockValid := NowUs >= lastTimeUs;
// Changes require a new FB instance/domain initialization, not hidden remapping.
IF (Config.DomainId <> pinnedConfig.DomainId) OR (Config.SchemaId <> pinnedConfig.SchemaId)
    OR (Config.TimeoutUs <> pinnedConfig.TimeoutUs) OR (Config.DigitalCount <> pinnedConfig.DigitalCount)
    OR (Config.SignedCount <> pinnedConfig.SignedCount) OR (Config.UnsignedCount <> pinnedConfig.UnsignedCount)
    OR (Config.RealCount <> pinnedConfig.RealCount) OR (BootId <> Status.BootIdentity)
    OR NOT Status.ClockValid THEN
    Status.ReconfigureRequired := TRUE;
END_IF;
resetEdge := Request.SessionResetRequest AND NOT previousReset;
previousReset := Request.SessionResetRequest;
simulationResetEdge := Request.SimulationResetRequest AND NOT previousSimulationReset;
previousSimulationReset := Request.SimulationResetRequest;
commitChanged := Request.RequestedSequence <> lastRequestSequence;

IF Request.SimRequest AND NOT previousSim THEN
    active := zero;
    Status.AppliedEpoch := 0;
    Status.AppliedSequence := 0;
    Status.AppliedCycle := Status.Cycle;
    Status.AppliedTimeUs := NowUs;
    Status.ActiveSlot := 255;
    lastRequestSequence := Request.RequestedSequence;
    commitChanged := FALSE; // old staged data cannot apply on entry
    haveHeartbeat := FALSE;
END_IF;
previousSim := Request.SimRequest;

staleAtScanEntry := NOT haveHeartbeat;
IF haveHeartbeat AND Status.ClockValid THEN
    staleAtScanEntry := (NowUs - lastHeartbeatUs) > Config.TimeoutUs;
END_IF;
IF Request.Heartbeat <> previousHeartbeat THEN
    previousHeartbeat := Request.Heartbeat;
    lastHeartbeatUs := NowUs;
    haveHeartbeat := TRUE;
END_IF;
Status.ConnectorStale := NOT haveHeartbeat;
IF haveHeartbeat AND Status.ClockValid THEN
    Status.ConnectorStale := (NowUs - lastHeartbeatUs) > Config.TimeoutUs;
END_IF;
IF NOT validConfig THEN Status.LastResult := 1; END_IF;
IF NOT Status.ClockValid THEN Status.LastResult := 2; END_IF;
IF Status.ReconfigureRequired THEN Status.LastResult := 9; END_IF;

IF Request.SimRequest AND (resetEdge OR simulationResetEdge) AND validConfig AND NOT Status.ReconfigureRequired THEN
    // Session reset retains the image; explicit simulation reset zeros it.
    IF simulationResetEdge THEN
        active := zero;
        Status.SimulationResetCount := Status.SimulationResetCount + 1;
    END_IF;
    Status.AppliedEpoch := 0;
    Status.AppliedSequence := 0;
    Status.AppliedCycle := Status.Cycle;
    Status.AppliedTimeUs := NowUs;
    Status.ActiveSlot := 255;
    IF resetEdge THEN Status.SessionResetCount := Status.SessionResetCount + 1; END_IF;
    lastRequestSequence := Request.RequestedSequence;
    commitChanged := FALSE;
END_IF;

IF Request.SimRequest AND commitChanged AND validConfig AND NOT Status.ReconfigureRequired THEN
    accept := FALSE;
    IF (Request.RequestedSlot > 1) OR (Request.RequestedSlot = Status.ActiveSlot) THEN
        Status.LastResult := 3;
        Status.InvalidCount := Status.InvalidCount + 1;
    ELSE
        slot := Request.Slots[Request.RequestedSlot];
        IF NOT slot.Valid OR (slot.Epoch = 0) OR (slot.Sequence = 0) THEN
            Status.LastResult := 4;
            Status.InvalidCount := Status.InvalidCount + 1;
        ELSIF (slot.DomainId <> Config.DomainId) OR (slot.SchemaId <> Config.SchemaId)
            OR (slot.Epoch <> Request.RequestedEpoch) OR (slot.Sequence <> Request.RequestedSequence) THEN
            Status.LastResult := 5;
            Status.InvalidCount := Status.InvalidCount + 1;
        ELSIF Status.AppliedEpoch = 0 THEN
            accept := TRUE;
        ELSIF slot.Epoch = Status.AppliedEpoch THEN
            IF slot.Sequence = Status.AppliedSequence THEN
                Status.LastResult := 6;
                Status.DuplicateCount := Status.DuplicateCount + 1;
            ELSIF slot.Sequence < Status.AppliedSequence THEN
                Status.LastResult := 7;
                Status.StaleCount := Status.StaleCount + 1;
            ELSE
                IF slot.Sequence - Status.AppliedSequence > 1 THEN Status.SkippedCount := Status.SkippedCount + 1; END_IF;
                accept := TRUE;
            END_IF;
        ELSIF staleAtScanEntry OR resetEdge THEN
            accept := TRUE;
        ELSE
            Status.LastResult := 8;
            Status.EpochRejectedCount := Status.EpochRejectedCount + 1;
        END_IF;
        IF accept THEN
            active := slot.Data;
            Status.ActiveSlot := Request.RequestedSlot;
            Status.AppliedEpoch := slot.Epoch;
            Status.AppliedSequence := slot.Sequence;
            Status.AppliedCycle := Status.Cycle;
            Status.AppliedTimeUs := NowUs;
            Status.CommitCount := Status.CommitCount + 1;
        END_IF;
    END_IF;
END_IF;
IF commitChanged THEN lastRequestSequence := Request.RequestedSequence; END_IF;
Status.SimApplied := Request.SimRequest; // bad config never silently selects hardware
di(Hardware := Hardware.Digital, Simulated := active.Digital, SimApplied := Status.SimApplied);
ai(Hardware := Hardware.Numeric, Simulated := active.Numeric, SimApplied := Status.SimApplied);
Image.Digital := di.Selected;
Image.Numeric := ai.Selected;
lastTimeUs := NowUs;
END_FUNCTION_BLOCK
