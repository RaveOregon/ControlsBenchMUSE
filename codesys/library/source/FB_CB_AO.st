FUNCTION_BLOCK FB_CB_AO
VAR_INPUT
    Commands : ST_CB_Numeric; // authentic application commands
    Suppress : ST_CB_NumericMask; // explicit physical-sink configuration
    SuppressedValues : ST_CB_Numeric; // physical value while suppressed; default raw zero
END_VAR
VAR_OUTPUT
    Observed : ST_CB_Numeric; // always the authentic commands
    Physical : ST_CB_Numeric; // value for the physical sink
    Applied : ST_CB_NumericMask; // suppression mask applied by this call
    SuppressedCount : UINT;
END_VAR
VAR
    i : UINT;
END_VAR
Observed := Commands;
Physical := Commands;
Applied := Suppress;
SuppressedCount := 0;
FOR i := 0 TO 31 DO
    IF Suppress.Signed[i] THEN
        Physical.Signed[i] := SuppressedValues.Signed[i];
        SuppressedCount := SuppressedCount + 1;
    END_IF;
    IF Suppress.Unsigned[i] THEN
        Physical.Unsigned[i] := SuppressedValues.Unsigned[i];
        SuppressedCount := SuppressedCount + 1;
    END_IF;
END_FOR;
FOR i := 0 TO 15 DO
    IF Suppress.RealValue[i] THEN
        Physical.RealValue[i] := SuppressedValues.RealValue[i];
        SuppressedCount := SuppressedCount + 1;
    END_IF;
END_FOR;
END_FUNCTION_BLOCK
