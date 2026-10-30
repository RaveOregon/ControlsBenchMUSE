# AmznBrowserHmi — reusable browser HMI library

A pair of libraries that turn the patterns documented in `../docs/` into
parameterized, reusable building blocks. Use them when you want a slick
web-based HMI for a CODESYS PLC and you don't want to rewrite the bridge
boilerplate every project.

## What's here

```
lib/
├── README.md                           ← you are here
├── codesys/
│   ├── AmznBrowserHmi/                 ← CODESYS library source
│   │   ├── FB_MqttHmi.st               ← parameterized MQTT bridge FB
│   │   ├── FB_OpcUaHmi.st              ← OPC UA helper FB (mostly a marker)
│   │   ├── E_HmiPayloadType.st         ← enum for typed publish/subscribe
│   │   ├── library.md                  ← description, version, namespace
│   │   └── how-to-import.md            ← steps for adding to a CODESYS project
│   └── example/
│       ├── README.md                   ← walkthrough of the example
│       └── ExampleProgram.st           ← shows FB_MqttHmi in 5 lines
├── js/
│   ├── browser-hmi.js                  ← single-file JS lib for the browser
│   ├── browser-hmi.css                 ← optional default styling for widgets
│   ├── README.md                       ← API reference
│   └── examples/
│       ├── minimal.html                ← simplest usage
│       ├── stoplight.html              ← the demo, rebuilt on the lib
│       └── dashboard.html              ← multi-widget layout example
└── DESIGN.md                           ← why the API is shaped this way
```

## Two protocols, two paths

We provide separate FBs for MQTT and OPC UA because — as you discovered while
building the demo — they're appropriate for different use cases. You'll pick
one per project, not both.

| | MQTT | OPC UA |
|---|---|---|
| PLC-side code | `FB_MqttHmi` (this lib) | None (Symbol Configuration only) |
| Browser-side connection | Paho.js → broker | WebSocket → relay process → OPC UA |
| When | Custom HMI for users, multi-PLC, cloud streaming | Bench testing, drop-in to existing projects, multi-tool consumers |

See `../docs/09-drop-in-checklist.md` for the decision matrix. The browser
JS library handles both transports under the same widget API — your HTML
doesn't change when you switch protocols, only the connection setup.

## Quick start — MQTT path

CODESYS side, in any program or function block:

```iecst
VAR
    hmi : AmznBrowserHmi.FB_MqttHmi(
        sHost := '127.0.0.1',
        uiPort := 1883,
        sTopicPrefix := 'plant/line1');
END_VAR

hmi();   // call once per scan; manages connection automatically

hmi.PublishBool('running', G_State.xRunning);
hmi.PublishReal('speed',   G_State.rSpeed);
hmi.PublishByte('digIn',   G_IO.byInputs);

IF hmi.SubscribeBool('cmd/start') THEN
    G_State.xStartRequest := TRUE;
END_IF
```

Browser side, in HTML:

```html
<script src="browser-hmi.js"></script>
<script>
const hmi = new BrowserHmi({ transport: 'mqtt', host: 'localhost', port: 9001,
                             topicPrefix: 'plant/line1' });
hmi.lamp('running', '#lamp-running');
hmi.numeric('speed', '#speed-display', { format: '%.2f' });
hmi.button('cmd/start', '#start-btn', { value: '1' });
hmi.connect();
</script>
```

That's the whole pattern. Three lines per signal in CODESYS, three lines per
widget in HTML. No plumbing.

## Status

This is **iteration 1** — local-use, copy-into-project, source-visible. Once
the API is validated by use we'll harden it for distribution
(`.compiled-library` for CODESYS, npm package for the JS).

## Roadmap

- [ ] iteration 1: source-form library + JS lib in this folder
- [ ] iteration 2: compile CODESYS lib to `.compiled-library`, publish JS to npm
- [ ] later: TLS support, auth helpers, retained-state recovery
- [ ] later: more widgets (slider with snap-back, gauge, chart, status grid)
