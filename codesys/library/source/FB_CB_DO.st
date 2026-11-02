FUNCTION_BLOCK FB_CB_DO
VAR_INPUT
    Commands : ARRAY[0..63] OF BOOL; // authentic application commands
    Suppress : ARRAY[0..63] OF BOOL; // explicit physical-sink configuration
    SuppressedValues : ARRAY[0..63] OF BOOL; // physical value while suppressed; default FALSE
END_VAR
VAR_OUTPUT
    Observed : ARRAY[0..63] OF BOOL; // always the authentic commands
    Physical : ARRAY[0..63] OF BOOL; // value for the physical sink
    Applied : ARRAY[0..63] OF BOOL; // suppression mask applied by this call
    SuppressedCount : UINT;
END_VAR
VAR
    i : UINT;
END_VAR
Observed := Commands;
Applied := Suppress;
SuppressedCount := 0;
FOR i := 0 TO 63 DO
    IF Suppress[i] THEN
        Physical[i] := SuppressedValues[i];
        SuppressedCount := SuppressedCount + 1;
    ELSE
        Physical[i] := Commands[i];
    END_IF;
END_FOR;
END_FUNCTION_BLOCK
