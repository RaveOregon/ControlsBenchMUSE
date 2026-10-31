NAMESPACE GVL_BenchWrite
{attribute 'qualified_only'}
VAR_GLOBAL
    // Bench authority and commit request. Workstation-writable through OPC UA.
    SimRequest : BOOL := FALSE;
    SessionResetRequest : BOOL := FALSE;
    RequestedSlot : USINT := 0;
    RequestedEpoch : ULINT := 0;
    RequestedSequence : ULINT := 0;
    // Published compatibility placeholder; RequestedSequence is the active commit edge.
    CommitToken : ULINT := 0;
    WorkstationHeartbeat : ULINT := 0;

    // Slot 0 metadata.
    Slot0_Valid : BOOL := FALSE;
    Slot0_Epoch : ULINT := 0;
    Slot0_Sequence : ULINT := 0;

    // Slot 0 complete raw input image.
    Slot0_PE_Entry : BOOL := FALSE;
    Slot0_PE_D1Approach : BOOL := FALSE;
    Slot0_PE_D2Approach : BOOL := FALSE;
    Slot0_PE_ExitA : BOOL := FALSE;
    Slot0_PE_ExitB : BOOL := FALSE;
    Slot0_PE_Runout : BOOL := FALSE;
    Slot0_D1_HomeFB : BOOL := FALSE;
    Slot0_D1_ExtendedFB : BOOL := FALSE;
    Slot0_D2_HomeFB : BOOL := FALSE;
    Slot0_D2_ExtendedFB : BOOL := FALSE;
    Slot0_Drive_RunningFB : BOOL := FALSE;
    Slot0_Drive_Overload : BOOL := FALSE;
    Slot0_ExitA_Ready : BOOL := FALSE;
    Slot0_ExitB_Ready : BOOL := FALSE;
    Slot0_Runout_Ready : BOOL := FALSE;
    Slot0_Belt_SpeedActual : REAL := 0.0;
    Slot0_Drive_Current : REAL := 0.0;
    Slot0_D1_Position : REAL := 0.0;
    Slot0_D2_Position : REAL := 0.0;
    Slot0_Encoder_Count : UDINT := 0;

    // Slot 1 metadata.
    Slot1_Valid : BOOL := FALSE;
    Slot1_Epoch : ULINT := 0;
    Slot1_Sequence : ULINT := 0;

    // Slot 1 complete raw input image.
    Slot1_PE_Entry : BOOL := FALSE;
    Slot1_PE_D1Approach : BOOL := FALSE;
    Slot1_PE_D2Approach : BOOL := FALSE;
    Slot1_PE_ExitA : BOOL := FALSE;
    Slot1_PE_ExitB : BOOL := FALSE;
    Slot1_PE_Runout : BOOL := FALSE;
    Slot1_D1_HomeFB : BOOL := FALSE;
    Slot1_D1_ExtendedFB : BOOL := FALSE;
    Slot1_D2_HomeFB : BOOL := FALSE;
    Slot1_D2_ExtendedFB : BOOL := FALSE;
    Slot1_Drive_RunningFB : BOOL := FALSE;
    Slot1_Drive_Overload : BOOL := FALSE;
    Slot1_ExitA_Ready : BOOL := FALSE;
    Slot1_ExitB_Ready : BOOL := FALSE;
    Slot1_Runout_Ready : BOOL := FALSE;
    Slot1_Belt_SpeedActual : REAL := 0.0;
    Slot1_Drive_Current : REAL := 0.0;
    Slot1_D1_Position : REAL := 0.0;
    Slot1_D2_Position : REAL := 0.0;
    Slot1_Encoder_Count : UDINT := 0;
END_VAR
END_NAMESPACE
