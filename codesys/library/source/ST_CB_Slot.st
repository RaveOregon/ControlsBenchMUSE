TYPE ST_CB_Slot :
STRUCT
    Valid : BOOL;
    DomainId : UDINT;
    SchemaId : UDINT;
    Epoch : ULINT;
    Sequence : ULINT;
    Data : ST_CB_Image;
END_STRUCT
END_TYPE
