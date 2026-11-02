FUNCTION F_CB_CheckImage : UINT
VAR_INPUT
    Image : ST_CB_Image; // candidate image from a workstation slot
    Config : ST_CB_Config; // pinned domain configuration
END_VAR
VAR_OUTPUT
    Bank : USINT; // GVL_CB.BANK_* of the first failing channel
    Index : UINT;
END_VAR
VAR
    i : UINT;
    bits : USINT;
    maxValue : UDINT;
    raw : U_CB_Real32;
END_VAR
// Rejects values a configured native type cannot represent, non-finite REAL on
// finite-only channels, and nonzero data in unconfigured channels. It never
// clamps, rounds or substitutes a value; the caller keeps the prior image.
F_CB_CheckImage := GVL_CB.RESULT_NONE;
Bank := GVL_CB.BANK_NONE;
Index := 0;
FOR i := 0 TO 63 DO
    IF (i >= Config.DigitalCount) AND Image.Digital[i] THEN
        F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
        Bank := GVL_CB.BANK_DIGITAL;
        Index := i;
        RETURN;
    END_IF;
END_FOR;
FOR i := 0 TO 31 DO
    IF i < Config.SignedCount THEN
        bits := Config.SignedBits[i];
        IF ((bits = 8) AND ((Image.Numeric.Signed[i] < -128) OR (Image.Numeric.Signed[i] > 127)))
            OR ((bits = 16) AND ((Image.Numeric.Signed[i] < -32768) OR (Image.Numeric.Signed[i] > 32767))) THEN
            F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
            Bank := GVL_CB.BANK_SIGNED;
            Index := i;
            RETURN;
        END_IF;
    ELSIF Image.Numeric.Signed[i] <> 0 THEN
        F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
        Bank := GVL_CB.BANK_SIGNED;
        Index := i;
        RETURN;
    END_IF;
END_FOR;
FOR i := 0 TO 31 DO
    IF i < Config.UnsignedCount THEN
        bits := Config.UnsignedBits[i];
        IF bits >= 32 THEN
            maxValue := 16#FFFFFFFF;
        ELSE
            maxValue := SHL(UDINT#1, bits) - 1;
        END_IF;
        IF Image.Numeric.Unsigned[i] > maxValue THEN
            F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
            Bank := GVL_CB.BANK_UNSIGNED;
            Index := i;
            RETURN;
        END_IF;
    ELSIF Image.Numeric.Unsigned[i] <> 0 THEN
        F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
        Bank := GVL_CB.BANK_UNSIGNED;
        Index := i;
        RETURN;
    END_IF;
END_FOR;
FOR i := 0 TO 15 DO
    raw.AsReal := Image.Numeric.RealValue[i];
    IF i < Config.RealCount THEN
        IF ((raw.AsBits AND 16#7F800000) = 16#7F800000) AND NOT Config.RealNonFiniteAllowed[i] THEN
            F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
            Bank := GVL_CB.BANK_REAL;
            Index := i;
            RETURN;
        END_IF;
    ELSIF raw.AsBits <> 0 THEN
        F_CB_CheckImage := GVL_CB.RESULT_REPRESENTATION;
        Bank := GVL_CB.BANK_REAL;
        Index := i;
        RETURN;
    END_IF;
END_FOR;
END_FUNCTION
