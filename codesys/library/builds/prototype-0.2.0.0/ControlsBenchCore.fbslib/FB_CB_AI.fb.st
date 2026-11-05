FUNCTION_BLOCK FB_CB_AI
VAR_INPUT
    Hardware : ST_CB_Numeric;
    Simulated : ST_CB_Numeric;
    SimApplied : BOOL;
END_VAR
VAR_OUTPUT
    Selected : ST_CB_Numeric;
END_VAR
IF SimApplied THEN Selected := Simulated; ELSE Selected := Hardware; END_IF;
END_FUNCTION_BLOCK