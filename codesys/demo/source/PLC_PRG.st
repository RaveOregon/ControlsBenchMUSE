PROGRAM PLC_PRG
VAR
    BenchIntercept : FB_BenchIntercept;
    Conveyor : FB_DemoConveyor;
END_VAR
// First call latches one complete raw image for all downstream application logic.
BenchIntercept(Hardware := GVL_DemoHardware.Inputs);
Conveyor(I := BenchIntercept.Image, NowUs := GVL_BenchRead.PlcTimeUs,
    StartSequence := GVL_DemoWrite.StartSequence,
    StopSequence := GVL_DemoWrite.StopSequence,
    ResetSequence := GVL_DemoWrite.ResetSequence,
    AutoRequest := GVL_DemoWrite.AutoRequest,
    OfferSequence := GVL_DemoWrite.OfferSequence,
    OfferItemId := GVL_DemoWrite.OfferItemId,
    OfferRoute := GVL_DemoWrite.OfferRoute,
    CompletionAck := GVL_DemoWrite.CompletionAck);
GVL_DemoRead.Status := Conveyor.Q;

// Authentic application commands, tapped before the physical sink.
GVL_BenchRead.Motor_RunCmd := Conveyor.Q.Motor_RunCmd;
GVL_BenchRead.D1_ExtendCmd := Conveyor.Q.D1_ExtendCmd;
GVL_BenchRead.D2_ExtendCmd := Conveyor.Q.D2_ExtendCmd;
GVL_BenchRead.StackLight_Red := Conveyor.Q.StackLight_Red;
GVL_BenchRead.StackLight_Green := Conveyor.Q.StackLight_Green;
GVL_DemoHardware.Motor_RunCmd := Conveyor.Q.Motor_RunCmd;
GVL_DemoHardware.D1_ExtendCmd := Conveyor.Q.D1_ExtendCmd;
GVL_DemoHardware.D2_ExtendCmd := Conveyor.Q.D2_ExtendCmd;
GVL_DemoHardware.StackLight_Red := Conveyor.Q.StackLight_Red;
GVL_DemoHardware.StackLight_Green := Conveyor.Q.StackLight_Green;
GVL_BenchRead.OutputSourceEpoch := GVL_BenchRead.AppliedEpoch;
GVL_BenchRead.OutputSourceSequence := GVL_BenchRead.AppliedSequence;
GVL_BenchRead.OutputSourceAppliedCycle := GVL_BenchRead.AppliedCaptureCycle;
GVL_BenchRead.OutputCaptureCycle := GVL_BenchRead.PlcCycle;
GVL_BenchRead.OutputCaptureTimeUs := GVL_BenchRead.PlcTimeUs;
END_PROGRAM
