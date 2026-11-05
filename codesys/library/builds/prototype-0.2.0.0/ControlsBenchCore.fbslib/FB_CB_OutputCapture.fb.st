FUNCTION_BLOCK FB_CB_OutputCapture
VAR_INPUT
    InputStatus : ST_CB_Status;
    Commands : ST_CB_Image;
    NowUs : ULINT;
END_VAR
VAR_OUTPUT
    PublicationRevision : ULINT; // odd while updating; even after publication
    Observed : ST_CB_Image;
    BootIdentity : ULINT;
    DomainId : UDINT;
    SchemaId : UDINT;
    SourceSimulated : BOOL;
    SourceEpoch : ULINT;
    SourceSequence : ULINT;
    InputAppliedCycle : ULINT;
    CaptureCycle : ULINT;
    CaptureTimeUs : ULINT;
END_VAR
// Call after application/output computation, within the same task as Session.
PublicationRevision := PublicationRevision + 1;
Observed := Commands;
BootIdentity := InputStatus.BootIdentity;
DomainId := InputStatus.DomainId;
SchemaId := InputStatus.SchemaId;
SourceSimulated := InputStatus.SimApplied;
SourceEpoch := InputStatus.AppliedEpoch;
SourceSequence := InputStatus.AppliedSequence;
InputAppliedCycle := InputStatus.AppliedCycle;
CaptureCycle := InputStatus.Cycle;
CaptureTimeUs := NowUs;
PublicationRevision := PublicationRevision + 1;
END_FUNCTION_BLOCK