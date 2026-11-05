FUNCTION_BLOCK FB_CB_DI
VAR_INPUT
    Hardware : ARRAY[0..63] OF BOOL;
    Simulated : ARRAY[0..63] OF BOOL;
    SimApplied : BOOL;
END_VAR
VAR_OUTPUT
    Selected : ARRAY[0..63] OF BOOL;
END_VAR
IF SimApplied THEN Selected := Simulated; ELSE Selected := Hardware; END_IF;
END_FUNCTION_BLOCK