TYPE ST_CB_Status :
STRUCT
    ProtocolVersion : UDINT := 1;
    DomainId : UDINT;
    SchemaId : UDINT;
    ConfigValid : BOOL;
    ClockValid : BOOL;
    SimApplied : BOOL;
    ConnectorStale : BOOL;
    BootIdentity : ULINT;
    Cycle : ULINT;
    TimeUs : ULINT;
    ActiveSlot : USINT := 255;
    AppliedEpoch : ULINT;
    AppliedSequence : ULINT;
    AppliedCycle : ULINT;
    AppliedTimeUs : ULINT;
    CommitCount : ULINT;
    DuplicateCount : ULINT;
    StaleCount : ULINT;
    SkippedCount : ULINT;
    InvalidCount : ULINT;
    EpochRejectedCount : ULINT;
    SessionResetCount : ULINT;
    SimulationResetCount : ULINT;
    ReconfigureRequired : BOOL;
    LastResult : UINT; // 0 idle/accepted; 1 config; 2 clock; 3 slot; 4 invalid;
                      // 5 metadata; 6 duplicate; 7 stale; 8 epoch; 9 reconfigure
END_STRUCT
END_TYPE
