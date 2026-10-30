# FB_MqttHmi — example walkthrough

A minimal CODESYS program showing how to use `FB_MqttHmi` in your own
project.

## Files

- `ExampleProgram.st` — copy into your project as a Program POU (paste
  the body, including the `PROGRAM ... END_PROGRAM` lines stripped if
  CODESYS doesn't accept them in the body editor).

## What it shows

The canonical 3-line pattern:

```iecst
hmi : FB_MqttHmi;                                 // declare
hmi(sHost := '...', sTopicPrefix := '...');      // call once per scan
hmi.PublishBool('channel', someBool);            // publish (per signal)
```

Each `Publish<Type>` call:

- Allocates a slot on first use (up to `MAX_PUB_CHANNELS = 32`).
- Builds a topic name as `<sTopicPrefix>/<channelName>`.
- Tracks the last value and triggers an MQTT publish only when the
  value changes (or on first scan).
- Sets the underlying `MQTTPublish` instance's `xExecute` for one scan,
  then auto-clears.

Caller cost: one line per signal. No POU code beyond that.

## Subscribing

```iecst
IF hmi.SubscribeBool('cmd/start') THEN
    xRunning := TRUE;
END_IF
```

`SubscribeBool` returns TRUE for exactly one scan after a message
arrives on `<sTopicPrefix>/cmd/start`. Caller is responsible for
latching if they need persistence beyond one scan.

For non-trivial payloads, use `SubscribePayload` which returns a pointer
to the raw bytes plus the size.

## Verifying it works

Once running, in PowerShell:

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "plant/line1/#" -v
```

You should see lines for every channel you Publish, and they'll only
re-emit when the value actually changes.

## Limits

- 32 publish channels per `FB_MqttHmi` instance (configurable in the FB
  source as `MAX_PUB_CHANNELS`).
- 16 subscribe channels per instance.
- Channel names up to 64 characters.
- Topic prefix + channel name combined up to ~120 characters.

If you need more, instantiate multiple `FB_MqttHmi` instances. They're
cheap; each just owns its own `MQTTClient` so you'll have multiple TCP
connections to the broker. Mosquitto handles dozens of these without
breaking a sweat.

## Where this example lives in the demo project

The demo workspace's CODESYS project has this exact program installed
as `Application.HmiTest`. It publishes to `plc/lib/example/...` so you
can see it side-by-side with the project's main bridge (`Mqtt_Bridge`,
which uses the same FB but publishes to `plc/stoplight/...`).

To watch both at once:

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "plc/#" -v
```
