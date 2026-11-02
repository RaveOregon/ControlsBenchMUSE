PROGRAM PLC_PRG
VAR
    Checks : FB_CB_ConsumerChecks; // conformance harness; compiled, not executed by this build
    nowUs : SysTimeCore.SYSTIME;
    timeResult : UDINT;
    bootId : ULINT; // example platform service: first-cycle monotonic time, nonzero
    // Conveyor domain: M8 raw signal set. Application logic is intentionally absent;
    // the inherited M8 controller POUs in this template are not called.
    ConveyorHw : ST_CONV_Inputs; // raw acquisition; wire to field I/O in a real project
    ConveyorApp : ST_CONV_Inputs; // what application logic consumes
    ConveyorCmd : ST_CONV_Outputs; // authentic application commands
    ConveyorSink : ST_CONV_Outputs; // physical sink after suppression
    ConveyorRequest : CB.ST_CB_Request;
    ConveyorSession : CB.FB_CB_Session;
    ConveyorDo : CB.FB_CB_DO;
    ConveyorAo : CB.FB_CB_AO;
    ConveyorCapture : CB.FB_CB_OutputCapture;
    ConveyorObservation : CB.FB_CB_Observation;
    ConveyorSuppress : CB.ST_CB_ImageMask; // explicit, empty: no suppression configured
    ConveyorCmdImage : CB.ST_CB_Image;
    ConveyorPhysical : CB.ST_CB_Image;
    ConveyorApplied : CB.ST_CB_ImageMask;
    NoTaps : CB.ST_CB_Image;
    // Tank domain: the non-conveyor example map with read-only PID observation taps.
    TankHw : ST_TANK_Inputs;
    TankApp : ST_TANK_Inputs;
    TankCmd : ST_TANK_Outputs;
    TankSink : ST_TANK_Outputs;
    TankTaps : ST_TANK_Taps; // copied from the loop's internal signals by the application
    TankRequest : CB.ST_CB_Request;
    TankSession : CB.FB_CB_Session;
    TankDo : CB.FB_CB_DO;
    TankAo : CB.FB_CB_AO;
    TankCapture : CB.FB_CB_OutputCapture;
    TankObservation : CB.FB_CB_Observation;
    TankSuppress : CB.ST_CB_ImageMask;
    TankCmdImage : CB.ST_CB_Image;
    TankPhysical : CB.ST_CB_Image;
    TankApplied : CB.ST_CB_ImageMask;
END_VAR
timeResult := SysTimeCore.SysTimeGetUs(nowUs);
IF bootId = 0 THEN
    bootId := nowUs;
    IF bootId = 0 THEN
        bootId := 1;
    END_IF;
END_IF;
Checks();

// Conveyor domain in the documented call order: acquisition, session, application,
// output taps, physical sink, capture and passive observation, all in this task.
ConveyorSession(Hardware := MAP_CONV_PackInputs(Source := ConveyorHw),
    Config := MAP_CONV_Config(DomainId := GVL_CONV_Map.DEFAULT_DOMAIN_ID),
    NowUs := nowUs, BootId := bootId, Request := ConveyorRequest);
ConveyorApp := MAP_CONV_UnpackInputs(Image := ConveyorSession.Image);
ConveyorCmdImage := MAP_CONV_PackOutputs(Source := ConveyorCmd);
ConveyorDo(Commands := ConveyorCmdImage.Digital, Suppress := ConveyorSuppress.Digital);
ConveyorAo(Commands := ConveyorCmdImage.Numeric, Suppress := ConveyorSuppress.Numeric);
ConveyorPhysical.Digital := ConveyorDo.Physical;
ConveyorPhysical.Numeric := ConveyorAo.Physical;
ConveyorApplied.Digital := ConveyorDo.Applied;
ConveyorApplied.Numeric := ConveyorAo.Applied;
ConveyorSink := MAP_CONV_UnpackOutputs(Image := ConveyorPhysical);
ConveyorCapture(InputStatus := ConveyorSession.Status, Commands := ConveyorCmdImage, NowUs := nowUs);
ConveyorObservation(InputStatus := ConveyorSession.Status, RawInputs := ConveyorSession.Hardware,
    SelectedInputs := ConveyorSession.Image, Commands := ConveyorCmdImage, Physical := ConveyorPhysical,
    Suppressed := ConveyorApplied, Taps := NoTaps, TapSchemaId := GVL_CONV_Map.TAP_SCHEMA_ID, NowUs := nowUs);

// Tank domain: an independent session, request storage, timeout and schema.
TankSession(Hardware := MAP_TANK_PackInputs(Source := TankHw),
    Config := MAP_TANK_Config(DomainId := GVL_TANK_Map.DEFAULT_DOMAIN_ID),
    NowUs := nowUs, BootId := bootId, Request := TankRequest);
TankApp := MAP_TANK_UnpackInputs(Image := TankSession.Image);
TankCmdImage := MAP_TANK_PackOutputs(Source := TankCmd);
TankDo(Commands := TankCmdImage.Digital, Suppress := TankSuppress.Digital);
TankAo(Commands := TankCmdImage.Numeric, Suppress := TankSuppress.Numeric);
TankPhysical.Digital := TankDo.Physical;
TankPhysical.Numeric := TankAo.Physical;
TankApplied.Digital := TankDo.Applied;
TankApplied.Numeric := TankAo.Applied;
TankSink := MAP_TANK_UnpackOutputs(Image := TankPhysical);
TankCapture(InputStatus := TankSession.Status, Commands := TankCmdImage, NowUs := nowUs);
TankObservation(InputStatus := TankSession.Status, RawInputs := TankSession.Hardware,
    SelectedInputs := TankSession.Image, Commands := TankCmdImage, Physical := TankPhysical,
    Suppressed := TankApplied, Taps := MAP_TANK_PackTaps(Source := TankTaps),
    TapSchemaId := GVL_TANK_Map.TAP_SCHEMA_ID, NowUs := nowUs);
END_PROGRAM
