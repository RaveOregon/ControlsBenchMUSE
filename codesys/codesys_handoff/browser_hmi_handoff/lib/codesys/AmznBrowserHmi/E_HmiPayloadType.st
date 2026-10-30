// E_HmiPayloadType — internal enum used by FB_MqttHmi to tag each
// publish slot with the type that allocated it. Used for change detection
// against the right "last value" array.

{attribute 'qualified_only'}
{attribute 'strict'}
TYPE E_HmiPayloadType :
(
    tNone   := 0,
    tBool   := 1,
    tReal   := 2,
    tDInt   := 3,
    tByte   := 4,
    tString := 5
) := tNone;
END_TYPE
