TYPE ST_CB_Config :
STRUCT
    DomainId : UDINT;
    SchemaId : UDINT; // versioned mapping identity; zero is invalid
    TimeoutUs : ULINT := 500000;
    DigitalCount : UINT;
    SignedCount : UINT;
    UnsignedCount : UINT;
    RealCount : UINT;
END_STRUCT
END_TYPE
