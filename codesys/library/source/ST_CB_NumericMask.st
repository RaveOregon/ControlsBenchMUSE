TYPE ST_CB_NumericMask :
STRUCT
    Signed : ARRAY[0..31] OF BOOL;
    Unsigned : ARRAY[0..31] OF BOOL;
    RealValue : ARRAY[0..15] OF BOOL;
END_STRUCT
END_TYPE
