# M8-E minimal WebVisu bindings (after A–D pass)

Status: deferred after A–D passed; not authored or tested. The official CODESYS MCP supports ST code, task calls, and compilation; it cannot create/edit a Visualization, Visualization Manager, WebVisu, or Symbol Set. These are the exact operator actions for a later M8-E. Do not use general computer control.

Create one Visualization named ConveyorDemo, a Visualization Manager, and WebVisu targeting ConveyorDemo. Use the default runtime WebVisu configuration. A basic table of text fields/lamps is sufficient.

| Element / stable visible label | Binding/action |
|---|---|
| Start button | OnMouseClick execute ST: GVL_DemoWrite.StartSequence := GVL_DemoWrite.StartSequence + 1; |
| Stop button | OnMouseClick execute ST: GVL_DemoWrite.StopSequence := GVL_DemoWrite.StopSequence + 1; |
| Reset button | OnMouseClick execute ST: GVL_DemoWrite.ResetSequence := GVL_DemoWrite.ResetSequence + 1; |
| Auto checkbox | GVL_DemoWrite.AutoRequest |
| Mode / active fault | GVL_DemoRead.Status.ModeText, FaultCode, FaultText |
| Start / Reset accepted | GVL_DemoRead.Status.StartAccepted, ResetAccepted |
| Bench simulation / STALE — INPUTS HELD | GVL_BenchRead.SimApplied, ConnectorStale; show stale in amber and label values held/unknown |
| Motor command / running feedback | GVL_BenchRead.Motor_RunCmd, Active_Drive_RunningFB |
| D1 command / home / extended | GVL_BenchRead.D1_ExtendCmd, Active_D1_HomeFB, Active_D1_ExtendedFB |
| D2 command / home / extended | GVL_BenchRead.D2_ExtendCmd, Active_D2_HomeFB, Active_D2_ExtendedFB |
| Current item / requested / effective route | GVL_DemoRead.Status.ActiveItemId, RequestedRoute, EffectiveRoute |
| Actual exit / disposition / exception | GVL_DemoRead.Status.ActualExit, Disposition, ExceptionText |
| A ready / B ready / runout ready | GVL_BenchRead.Active_ExitA_Ready, Active_ExitB_Ready, Active_Runout_Ready |
| Counts A / B / runout / misroute / faulted | GVL_DemoRead.Status.CountExitA, CountExitB, CountRunout, CountMisroute, CountFaulted |
| Release ready / offer acknowledgement / completion pending | GVL_DemoRead.Status.ReleaseReady, OfferAckSequence, CompletionPending |

Show route legend Unknown=0, A=1, B=2; exit Runout=3. Show disposition legend Sorted=1, Runout unassigned=2, Misrouted=3, Faulted=4. Values are command versus actual feedback, never a single merged motor/divert lamp. Connector stale is an amber bench diagnostic, not a red machine fault.

Compile, save, download, run, open the configured WebVisu URL, and exercise Start, Stop, Reset, and Auto while checking the same UA fields. Preserve an operator screenshot or recording with UTC time and related smoke-run ID. Do not claim M8-E passed from these planned bindings alone.
