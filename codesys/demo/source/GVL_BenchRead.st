NAMESPACE GVL_BenchRead
{attribute 'qualified_only'}
VAR_GLOBAL
    // Bench state and liveness. Workstation read-only through OPC UA.
    SimApplied : BOOL := FALSE;
    ConnectorStale : BOOL := TRUE;
    ActiveSlot : USINT := 255;
    AppliedEpoch : ULINT := 0;
    AppliedSequence : ULINT := 0;
    // Published compatibility placeholders retained by the configured symbol type.
    AppliedCaptureCycle : ULINT := 0;
    AppliedCaptureTimeUs : ULINT := 0;
    PlcHeartbeat : ULINT := 0;
    PlcBootIdentity : ULINT := 0;
    PlcCycle : ULINT := 0;
    PlcTimeUs : ULINT := 0;

    // Commit diagnostics.
    AppliedCommitCount : ULINT := 0;
    DuplicateCommitCount : ULINT := 0;
    StaleCommitCount : ULINT := 0;
    SkippedSequenceCount : ULINT := 0;
    InvalidSlotCount : ULINT := 0;
    InvalidPayloadCount : ULINT := 0;
    SlotMetadataMismatchCount : ULINT := 0;
    EpochRejectedCount : ULINT := 0;
    SessionResetCount : ULINT := 0;

    // Application-visible active raw input image.
    Active_PE_Entry : BOOL := FALSE;
    Active_PE_D1Approach : BOOL := FALSE;
    Active_PE_D2Approach : BOOL := FALSE;
    Active_PE_ExitA : BOOL := FALSE;
    Active_PE_ExitB : BOOL := FALSE;
    Active_PE_Runout : BOOL := FALSE;
    Active_D1_HomeFB : BOOL := FALSE;
    Active_D1_ExtendedFB : BOOL := FALSE;
    Active_D2_HomeFB : BOOL := FALSE;
    Active_D2_ExtendedFB : BOOL := FALSE;
    Active_Drive_RunningFB : BOOL := FALSE;
    Active_Drive_Overload : BOOL := FALSE;
    Active_ExitA_Ready : BOOL := FALSE;
    Active_ExitB_Ready : BOOL := FALSE;
    Active_Runout_Ready : BOOL := FALSE;
    Active_Belt_SpeedActual : REAL := 0.0;
    Active_Drive_Current : REAL := 0.0;
    Active_D1_Position : REAL := 0.0;
    Active_D2_Position : REAL := 0.0;
    Active_Encoder_Count : UDINT := 0;

    // Fixture-only deterministic PLC output image.
    Motor_RunCmd : BOOL := FALSE;
    D1_ExtendCmd : BOOL := FALSE;
    D2_ExtendCmd : BOOL := FALSE;
    StackLight_Red : BOOL := FALSE;
    StackLight_Green : BOOL := FALSE;
    OutputSourceEpoch : ULINT := 0;
    OutputSourceSequence : ULINT := 0;
    OutputSourceAppliedCycle : ULINT := 0;
    OutputCaptureCycle : ULINT := 0;
    OutputCaptureTimeUs : ULINT := 0;
END_VAR
END_NAMESPACE
