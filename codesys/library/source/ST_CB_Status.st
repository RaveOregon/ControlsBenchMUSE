TYPE ST_CB_Status :
STRUCT
    ProtocolVersion : UDINT := 2; // GVL_CB.PROTOCOL_VERSION
    DomainId : UDINT; // pinned at initialization
    SchemaId : UDINT; // pinned at initialization
    ConfigValid : BOOL;
    ClockValid : BOOL; // this cycle's time was not earlier than the previous cycle's
    ReconfigureRequired : BOOL; // latched by config, boot or clock change; cleared only by Reinitialize
    SimApplied : BOOL; // TRUE: the application consumes the workstation image
    ConnectorStale : BOOL := TRUE;
    BootIdentity : ULINT;
    Cycle : ULINT; // calls of this domain session, not universal PLC scans
    TimeUs : ULINT;
    LastHeartbeat : ULINT;
    LastHeartbeatTimeUs : ULINT;
    ActiveSlot : USINT := 255;
    AppliedEpoch : ULINT;
    AppliedSequence : ULINT;
    AppliedCycle : ULINT;
    AppliedTimeUs : ULINT;
    // Acknowledgement of the last consumed request event, accepted or not.
    ConsumedEpoch : ULINT;
    ConsumedSequence : ULINT;
    ConsumedSlot : USINT := 255;
    ConsumedResult : UINT; // GVL_CB.RESULT_*
    ConsumedCycle : ULINT;
    ConsumedTimeUs : ULINT;
    RejectBank : USINT; // GVL_CB.BANK_* of the first channel failing representation checks
    RejectIndex : UINT;
    CommitCount : ULINT;
    DuplicateCount : ULINT;
    StaleCount : ULINT;
    SkippedCount : ULINT;
    InvalidSlotCount : ULINT;
    IncompleteSlotCount : ULINT;
    MetadataMismatchCount : ULINT;
    RepresentationRejectedCount : ULINT;
    EpochRejectedCount : ULINT;
    NotSimulatedCount : ULINT;
    BlockedRequestCount : ULINT;
    IdleClearCount : ULINT;
    SessionResetCount : ULINT;
    SimulationResetCount : ULINT;
    SimulationEntryCount : ULINT;
    ReinitializeCount : ULINT;
END_STRUCT
END_TYPE
