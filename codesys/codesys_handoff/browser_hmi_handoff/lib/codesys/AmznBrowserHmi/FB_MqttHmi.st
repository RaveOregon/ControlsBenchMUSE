// FB_MqttHmi — parameterized MQTT bridge for browser HMI work.
//
// Wraps MQTT.MQTTClient + a pool of MQTTPublish/MQTTSubscribe instances and
// exposes typed Publish<Type> / Subscribe<Type> methods that handle change
// detection, payload formatting, and one-shot trigger pulses internally.
//
// Caller writes 3 lines per signal (declare, publish on change). All the
// MQTT plumbing — xEnable, WSTRING(1024) topic strings, change-trigger
// edges, payload buffers — is hidden inside.
//
// Limits:
//   MAX_PUB_CHANNELS = 32 (per FB instance)
//   MAX_SUB_CHANNELS = 16
//   Channel name up to 64 chars
//   Topic prefix + channel up to ~120 chars
//
// Usage:
//
//   VAR
//       hmi : FB_MqttHmi;
//   END_VAR
//
//   hmi(sHost := '127.0.0.1',
//       uiPort := 1883,
//       sTopicPrefix := 'plant/line1');
//
//   hmi.PublishBool('running', G_State.xRunning);
//   hmi.PublishReal('speed',   G_State.rSpeed);
//
//   IF hmi.SubscribeBool('cmd/start') THEN
//       G_State.xStartRequest := TRUE;
//   END_IF
//
// Validated against CODESYS V3.5 SP22.20 with MQTT Client SL.

{attribute 'analysis' := '-33,-11,-26'}
FUNCTION_BLOCK FB_MqttHmi
VAR_INPUT
    // Broker connection.
    sHost        : STRING(80) := '127.0.0.1';
    uiPort       : UINT       := 1883;
    xUseTLS      : BOOL       := FALSE;
    uiKeepAlive  : UINT       := 5;

    // Topic namespacing — every channel will be published as
    // "<sTopicPrefix>/<channel>". Empty prefix is allowed.
    sTopicPrefix : STRING(64) := '';

    // Optional auth (leave empty for anonymous brokers).
    wsUsername : WSTRING(255) := "";
    wsPassword : WSTRING(255) := "";

    // Optional client id; auto-generated if empty.
    sClientId : STRING(64) := '';
END_VAR
VAR_OUTPUT
    qConnected : BOOL;
    qPubCount  : UINT;
    qSubCount  : UINT;
END_VAR
VAR CONSTANT
    MAX_PUB_CHANNELS : UINT := 32;
    MAX_SUB_CHANNELS : UINT := 16;
END_VAR
VAR
    // Underlying MQTT client.
    _client  : MQTT.MQTTClient;

    // ---- Publish-side state (parallel arrays keyed by slot) ----
    _pubChan       : ARRAY[0..31] OF STRING(64);
    _pubTopicWs    : ARRAY[0..31] OF WSTRING(1024);
    _pubInst       : ARRAY[0..31] OF MQTT.MQTTPublish;
    _pubLastBool   : ARRAY[0..31] OF BOOL;
    _pubLastReal   : ARRAY[0..31] OF REAL;
    _pubLastDInt   : ARRAY[0..31] OF DINT;
    _pubLastByte   : ARRAY[0..31] OF BYTE;
    _pubLastStr    : ARRAY[0..31] OF STRING(64);
    _pubKind       : ARRAY[0..31] OF E_HmiPayloadType;
    _pubFresh      : ARRAY[0..31] OF BOOL;
    _pubPayload    : ARRAY[0..31] OF STRING(64);
    _pubTrigger    : ARRAY[0..31] OF BOOL;
    _pubUsed       : UINT;

    // ---- Subscribe-side state ----
    _subChan       : ARRAY[0..15] OF STRING(64);
    _subTopicWs    : ARRAY[0..15] OF WSTRING(1024);
    _subInst       : ARRAY[0..15] OF MQTT.MQTTSubscribe;
    _subBuf        : ARRAY[0..15] OF ARRAY[0..127] OF BYTE;
    _subUsed       : UINT;

    _i : UINT;
END_VAR

// ============================================================================
// Body — drive the client, fire publishers, refresh subscribers.
// ============================================================================
_client(
    xEnable       := TRUE,
    sHostname     := sHost,
    uiPort        := uiPort,
    xUseTLS       := xUseTLS,
    uiKeepAlive   := uiKeepAlive,
    xCleanSession := TRUE,
    wsUsername    := wsUsername,
    wsPassword    := wsPassword,
    sClientId     := sClientId);

qConnected := _client.xConnectedToBroker;
qPubCount  := _pubUsed;
qSubCount  := _subUsed;

// IMPORTANT: must guard the FOR loop with `_pubUsed > 0` because UINT
// underflows when computing `_pubUsed - 1` if `_pubUsed = 0`.
IF _pubUsed > 0 THEN
    FOR _i := 0 TO _pubUsed - 1 DO
        _pubInst[_i](
            mqttClient     := _client,
            wsTopicName    := _pubTopicWs[_i],
            xExecute       := _pubTrigger[_i],
            eQoS           := MQTT.MQTT_QOS.QoS0,
            xRetain        := TRUE,
            pbPayload      := ADR(_pubPayload[_i]),
            udiPayloadSize := TO_UDINT(LEN(_pubPayload[_i])));
        _pubTrigger[_i] := FALSE;   // one-shot semantics
    END_FOR
END_IF

IF _subUsed > 0 THEN
    FOR _i := 0 TO _subUsed - 1 DO
        _subInst[_i](
            xEnable           := TRUE,
            mqttClient        := _client,
            wsTopicFilter     := _subTopicWs[_i],
            eSubscribeQoS     := MQTT.MQTT_QOS.QoS0,
            pbPayload         := ADR(_subBuf[_i]),
            udiMaxPayloadSize := SIZEOF(_subBuf[_i]));
    END_FOR
END_IF


METHOD PRIVATE _GetOrAllocPubSlot : UINT
VAR_INPUT
    sChan : STRING(64);
    eKind : E_HmiPayloadType;
END_VAR
VAR
    j : UINT;
    sFull : STRING(128);
END_VAR
    IF _pubUsed > 0 THEN
        FOR j := 0 TO _pubUsed - 1 DO
            IF _pubChan[j] = sChan THEN
                _GetOrAllocPubSlot := j;
                RETURN;
            END_IF
        END_FOR
    END_IF

    IF _pubUsed >= MAX_PUB_CHANNELS THEN
        _GetOrAllocPubSlot := 16#FFFF;
        RETURN;
    END_IF

    j := _pubUsed;
    _pubChan[j]  := sChan;
    _pubKind[j]  := eKind;
    _pubFresh[j] := TRUE;

    IF sTopicPrefix = '' THEN
        sFull := sChan;
    ELSE
        sFull := CONCAT(sTopicPrefix, '/');
        sFull := CONCAT(sFull, sChan);
    END_IF
    _pubTopicWs[j] := STRING_TO_WSTRING(sFull);

    _pubUsed := _pubUsed + 1;
    _GetOrAllocPubSlot := j;
END_METHOD


METHOD PRIVATE _GetOrAllocSubSlot : UINT
VAR_INPUT
    sChan : STRING(64);
END_VAR
VAR
    j : UINT;
    sFull : STRING(128);
END_VAR
    IF _subUsed > 0 THEN
        FOR j := 0 TO _subUsed - 1 DO
            IF _subChan[j] = sChan THEN
                _GetOrAllocSubSlot := j;
                RETURN;
            END_IF
        END_FOR
    END_IF

    IF _subUsed >= MAX_SUB_CHANNELS THEN
        _GetOrAllocSubSlot := 16#FFFF;
        RETURN;
    END_IF

    j := _subUsed;
    _subChan[j] := sChan;

    IF sTopicPrefix = '' THEN
        sFull := sChan;
    ELSE
        sFull := CONCAT(sTopicPrefix, '/');
        sFull := CONCAT(sFull, sChan);
    END_IF
    _subTopicWs[j] := STRING_TO_WSTRING(sFull);

    _subUsed := _subUsed + 1;
    _GetOrAllocSubSlot := j;
END_METHOD


METHOD PUBLIC PublishBool : BOOL
VAR_INPUT
    sChannel : STRING(64);
    xValue   : BOOL;
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocPubSlot(sChan := sChannel, eKind := E_HmiPayloadType.tBool);
    IF slot = 16#FFFF THEN
        PublishBool := FALSE;
        RETURN;
    END_IF
    IF _pubFresh[slot] OR (xValue <> _pubLastBool[slot]) THEN
        IF xValue THEN _pubPayload[slot] := 'true'; ELSE _pubPayload[slot] := 'false'; END_IF
        _pubLastBool[slot] := xValue;
        _pubFresh[slot] := FALSE;
        _pubTrigger[slot] := TRUE;
    END_IF
    PublishBool := TRUE;
END_METHOD


METHOD PUBLIC PublishReal : BOOL
VAR_INPUT
    sChannel : STRING(64);
    rValue   : REAL;
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocPubSlot(sChan := sChannel, eKind := E_HmiPayloadType.tReal);
    IF slot = 16#FFFF THEN
        PublishReal := FALSE;
        RETURN;
    END_IF
    IF _pubFresh[slot] OR (rValue <> _pubLastReal[slot]) THEN
        _pubPayload[slot] := REAL_TO_STRING(rValue);
        _pubLastReal[slot] := rValue;
        _pubFresh[slot] := FALSE;
        _pubTrigger[slot] := TRUE;
    END_IF
    PublishReal := TRUE;
END_METHOD


METHOD PUBLIC PublishDInt : BOOL
VAR_INPUT
    sChannel : STRING(64);
    diValue  : DINT;
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocPubSlot(sChan := sChannel, eKind := E_HmiPayloadType.tDInt);
    IF slot = 16#FFFF THEN
        PublishDInt := FALSE;
        RETURN;
    END_IF
    IF _pubFresh[slot] OR (diValue <> _pubLastDInt[slot]) THEN
        _pubPayload[slot] := DINT_TO_STRING(diValue);
        _pubLastDInt[slot] := diValue;
        _pubFresh[slot] := FALSE;
        _pubTrigger[slot] := TRUE;
    END_IF
    PublishDInt := TRUE;
END_METHOD


METHOD PUBLIC PublishByte : BOOL
VAR_INPUT
    sChannel : STRING(64);
    byValue  : BYTE;
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocPubSlot(sChan := sChannel, eKind := E_HmiPayloadType.tByte);
    IF slot = 16#FFFF THEN
        PublishByte := FALSE;
        RETURN;
    END_IF
    IF _pubFresh[slot] OR (byValue <> _pubLastByte[slot]) THEN
        _pubPayload[slot] := BYTE_TO_STRING(byValue);
        _pubLastByte[slot] := byValue;
        _pubFresh[slot] := FALSE;
        _pubTrigger[slot] := TRUE;
    END_IF
    PublishByte := TRUE;
END_METHOD


METHOD PUBLIC PublishString : BOOL
VAR_INPUT
    sChannel : STRING(64);
    sValue   : STRING(64);
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocPubSlot(sChan := sChannel, eKind := E_HmiPayloadType.tString);
    IF slot = 16#FFFF THEN
        PublishString := FALSE;
        RETURN;
    END_IF
    IF _pubFresh[slot] OR (sValue <> _pubLastStr[slot]) THEN
        _pubPayload[slot] := sValue;
        _pubLastStr[slot] := sValue;
        _pubFresh[slot] := FALSE;
        _pubTrigger[slot] := TRUE;
    END_IF
    PublishString := TRUE;
END_METHOD


METHOD PUBLIC SubscribeBool : BOOL
// Returns TRUE for one scan when a message arrives. Caller can latch.
VAR_INPUT
    sChannel : STRING(64);
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocSubSlot(sChan := sChannel);
    IF slot = 16#FFFF THEN
        SubscribeBool := FALSE;
        RETURN;
    END_IF
    SubscribeBool := _subInst[slot].xReceived;
END_METHOD


METHOD PUBLIC SubscribePayload : POINTER TO BYTE
// Lower-level: returns a pointer to the buffer + sets udiSize and xReceived.
// Caller pattern:
//   pBuf : POINTER TO BYTE;
//   sz   : UDINT;
//   rcv  : BOOL;
//   pBuf := hmi.SubscribePayload('cmd/data', udiSize => sz, xReceived => rcv);
VAR_INPUT
    sChannel : STRING(64);
END_VAR
VAR_OUTPUT
    udiSize   : UDINT;
    xReceived : BOOL;
END_VAR
VAR
    slot : UINT;
END_VAR
    slot := _GetOrAllocSubSlot(sChan := sChannel);
    IF slot = 16#FFFF THEN
        SubscribePayload := 0;
        udiSize := 0;
        xReceived := FALSE;
        RETURN;
    END_IF
    SubscribePayload := ADR(_subBuf[slot]);
    udiSize          := _subInst[slot].udiPayloadSize;
    xReceived        := _subInst[slot].xReceived;
END_METHOD

END_FUNCTION_BLOCK
