// Mqtt_Bridge — example using AmznBrowserHmi.FB_MqttHmi
//
// This is the canonical "smallest useful wrapper" pattern. The library
// FB handles all the plumbing (connection, change detection, payload
// formatting, slot allocation). This wrapper just lists the channels
// and what variables they map to.
//
// Compare with the hand-written Mqtt_Bridge.st in
// `docs/08-source-listing.md` — same external behavior, ~40 lines vs
// ~150.

{attribute 'analysis' := '-33,-11'}
PROGRAM Mqtt_Bridge
VAR
    hmi : FB_MqttHmi;
END_VAR
VAR_OUTPUT
    qSwitchFromBrowser : BOOL;
    qConnected         : BOOL;
END_VAR

// Drive the library FB. Configuration is passed every scan, but only
// the first call's values matter (the FB caches them).
hmi(sHost := '127.0.0.1',
    uiPort := 1883,
    sTopicPrefix := 'plc/stoplight');

qConnected := hmi.qConnected;

// Publish the StopLight state. Each call is idempotent on unchanged
// values — the FB only emits an MQTT message when the value changes.
hmi.PublishBool('red',    StopLight.qRed);
hmi.PublishBool('yellow', StopLight.qYellow);
hmi.PublishBool('green',  StopLight.qGreen);
hmi.PublishDInt('state',  TO_DINT(StopLight.qState));
hmi.PublishBool('armed',  PLC_PRG.byDigInByte.0);

// Subscribe to the browser-issued start-switch command.
// Returns TRUE for one scan when a message arrives.
qSwitchFromBrowser := hmi.SubscribeBool('switch/set');
END_PROGRAM
