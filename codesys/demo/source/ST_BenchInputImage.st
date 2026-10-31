TYPE ST_BenchInputImage :
STRUCT
    PE_Entry : BOOL;
    PE_D1Approach : BOOL;
    PE_D2Approach : BOOL;
    PE_ExitA : BOOL;
    PE_ExitB : BOOL;
    PE_Runout : BOOL;
    D1_HomeFB : BOOL;
    D1_ExtendedFB : BOOL;
    D2_HomeFB : BOOL;
    D2_ExtendedFB : BOOL;
    Drive_RunningFB : BOOL;
    Drive_Overload : BOOL;
    ExitA_Ready : BOOL;
    ExitB_Ready : BOOL;
    Runout_Ready : BOOL;
    Belt_SpeedActual : REAL;
    Drive_Current : REAL;
    D1_Position : REAL;
    D2_Position : REAL;
    Encoder_Count : UDINT;
END_STRUCT
END_TYPE
