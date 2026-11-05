TYPE ST_CB_ObservationFrame :
STRUCT
    FrameFormat : UDINT := 1; // GVL_CB.FRAME_FORMAT_VERSION
    FrameSequence : ULINT; // frames published by this block since initialization
    BootIdentity : ULINT;
    DomainId : UDINT;
    SchemaId : UDINT;
    TapSchemaId : UDINT; // fingerprint of the configured tap list; 0 when none is configured
    SourceCycle : ULINT; // session cycle whose inputs and outputs this frame holds
    SourceTimeUs : ULINT; // platform monotonic time at capture, not wall-clock time
    CapturePhase : USINT; // GVL_CB.PHASE_POST_OUTPUT
    MissedCycles : ULINT; // cumulative session cycles that published no frame
    RepeatedCycles : ULINT; // cumulative calls without a new session cycle (integration error)
    SimApplied : BOOL; // SelectedInputs came from the workstation, not hardware
    ConnectorStale : BOOL;
    ConfigValid : BOOL;
    ClockValid : BOOL;
    ReconfigureRequired : BOOL;
    AnySuppressed : BOOL;
    AppliedEpoch : ULINT;
    AppliedSequence : ULINT;
    RawInputs : ST_CB_Image; // hardware values presented to the session, in either mode
    SelectedInputs : ST_CB_Image; // image the application consumed
    Commands : ST_CB_Image; // authentic application commands before suppression
    Physical : ST_CB_Image; // physical sink values after suppression
    Suppressed : ST_CB_ImageMask; // channels whose physical sink was suppressed
    Taps : ST_CB_Image; // explicitly configured observation taps; never writable through this library
END_STRUCT
END_TYPE
