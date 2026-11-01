FUNCTION_BLOCK FB_CB_AO
VAR_INPUT
    Commands : ST_CB_Numeric;
    SuppressSigned : ARRAY[0..31] OF BOOL;
    SuppressUnsigned : ARRAY[0..31] OF BOOL;
    SuppressReal : ARRAY[0..15] OF BOOL;
    SuppressedValues : ST_CB_Numeric; // default raw zero, engineer-configured
END_VAR
VAR_OUTPUT
    Observed : ST_CB_Numeric;
    Physical : ST_CB_Numeric;
END_VAR
VAR
    i : INT;
END_VAR
Observed := Commands;
Physical := Commands;
FOR i := 0 TO 31 DO
    IF SuppressSigned[i] THEN Physical.Signed[i] := SuppressedValues.Signed[i]; END_IF;
    IF SuppressUnsigned[i] THEN Physical.Unsigned[i] := SuppressedValues.Unsigned[i]; END_IF;
END_FOR;
FOR i := 0 TO 15 DO
    IF SuppressReal[i] THEN Physical.RealValue[i] := SuppressedValues.RealValue[i]; END_IF;
END_FOR;
END_FUNCTION_BLOCK
