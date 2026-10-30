// Minimal example showing FB_MqttHmi in 5 lines.
//
// Drop this into any CODESYS project that already has FB_MqttHmi added
// (see ../AmznBrowserHmi/how-to-import.md). Add a program call to a task
// (MainTask is fine), build, login, run.
//
// Replace the variables on the right side of the Publish calls with your
// own application variables.

PROGRAM ExampleProgram
VAR
    hmi : FB_MqttHmi;

    // Stand-in application state — replace with your real signals.
    xRunning : BOOL;
    rSpeed   : REAL := 12.5;
    iCount   : DINT;
    byInputs : BYTE;
END_VAR

// 1) Drive the FB once per scan, passing the broker host and topic prefix.
hmi(sHost := '127.0.0.1',
    uiPort := 1883,
    sTopicPrefix := 'plant/line1');

// 2) Publish whatever you want, by typed method. Each Publish<Type>
//    call on a unique channel reserves a slot internally; subsequent
//    calls on the same channel are change-detected and only sent when
//    the value differs from the last published value.
hmi.PublishBool('running', xRunning);
hmi.PublishReal('speed',   rSpeed);
hmi.PublishDInt('count',   iCount);
hmi.PublishByte('inputs',  byInputs);

// 3) Subscribe to a command topic. The method returns TRUE for one
//    scan when a message arrives. Latch externally if you need
//    persistence.
IF hmi.SubscribeBool('cmd/start') THEN
    xRunning := TRUE;
END_IF

// (Just to make the example compile — toggle iCount so something moves
// over MQTT when you watch with mosquitto_sub.)
iCount := iCount + 1;

END_PROGRAM
