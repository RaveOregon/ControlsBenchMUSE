FUNCTION_BLOCK FB_CB_DO
VAR_INPUT
    Commands : ARRAY[0..63] OF BOOL;
    Suppress : ARRAY[0..63] OF BOOL; // explicit physical-sink configuration
END_VAR
VAR_OUTPUT
    Observed : ARRAY[0..63] OF BOOL;
    Physical : ARRAY[0..63] OF BOOL;
END_VAR
VAR
    i : INT;
END_VAR
Observed := Commands;
FOR i := 0 TO 63 DO Physical[i] := Commands[i] AND NOT Suppress[i]; END_FOR;
END_FUNCTION_BLOCK
