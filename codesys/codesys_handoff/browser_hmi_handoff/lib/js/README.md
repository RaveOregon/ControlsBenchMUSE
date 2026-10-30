# browser-hmi.js — API reference

A single-file JavaScript library for building PLC dashboards in the
browser. Works with either MQTT-over-WebSocket or our OPC UA WebSocket
relay. Same widget API for both transports.

## Files

- `browser-hmi.js` — the library. Loads in any browser, no build step.
- `browser-hmi.css` — optional default styling. Override freely.
- `examples/` — minimal HTML examples.

## Setup

For MQTT transport, include Paho before `browser-hmi.js`:

```html
<link rel="stylesheet" href="browser-hmi.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.0.1/mqttws31.min.js"></script>
<script src="browser-hmi.js"></script>
```

For the OPC UA WebSocket relay transport, just the lib:

```html
<link rel="stylesheet" href="browser-hmi.css">
<script src="browser-hmi.js"></script>
```

## Constructor

```javascript
const hmi = new BrowserHmi({
  transport: 'mqtt',          // or 'wsrelay'
  host:     'localhost',
  port:      9001,            // 9001 for MQTT-WS, 9876 for our relay
  path:     '/',              // optional, defaults to '/'
  topicPrefix: 'plant/line1', // MQTT only; prepended to widget channels
  // MQTT auth/tls (optional):
  userName: 'plcuser',
  password: 'pass',
  tls: false,
});
```

## Widget API

### `lamp(channel, selector, opts)`

Lights up an element when the channel value is truthy.

```javascript
hmi.lamp('running', '#lamp-1');
hmi.lamp('emergency', '#lamp-2', { color: 'red' });
```

`opts.color`: optional CSS class hint (`red`, `yellow`, `green`) — used
by `browser-hmi.css` to color the on-state glow.

### `numeric(channel, selector, opts)`

Displays a number with optional formatting.

```javascript
hmi.numeric('speed', '#speed-display', { format: '%.2f' });
hmi.numeric('count', '#count-display', { format: '%d' });
```

`opts.format`: printf-style string. Supports `%f`, `%.Nf`, `%d`, `%s`, `%i`.

### `text(channel, selector, opts)`

Displays a string. Optionally maps payload values to display text.

```javascript
hmi.text('state', '#state-label');

// With value mapping:
hmi.text('mode', '#mode-label', {
  map: { '0': 'Auto', '1': 'Manual', '2': 'Maintenance' }
});
```

### `indicator(channel, selector, opts)`

Pill-style on/off indicator.

```javascript
hmi.indicator('faulted', '#fault-pill', { onText: 'FAULT', offText: 'OK' });
```

### `button(channel, selector, opts)`

Publishes a value when clicked.

```javascript
// MQTT — publishes to channel topic:
hmi.button('cmd/start', '#btn-start', { value: '1' });

// OPC UA relay — needs nodeId and dataType:
hmi.button('startBtn', '#btn-start', {
  nodeId: 'ns=4;s=|var|...|MyPou.startBit',
  dataType: 'Boolean',
  value: true,
});
```

`opts.value`: payload to send on click. Default `'1'`.

For OPC UA: `opts.nodeId` and `opts.dataType` are required.

## Connection lifecycle

```javascript
hmi.onStatus((ok, msg) => {
  document.getElementById('conn').textContent = ok ? 'connected' : msg;
});
hmi.connect();
```

Auto-reconnect is built in (2-second backoff).

## Custom rendering — escape hatches

For widgets the lib doesn't have, hook the channel directly:

```javascript
// (informal — not officially in the API yet, but works)
hmi._handlers.set('myCustomChannel', [{
  update: (payload) => {
    // do anything with the live value
    myChart.appendData(parseFloat(payload));
  }
}]);
hmi._transport.subscribe(
  hmi._transport.kind === 'mqtt' ? 'plant/line1/myCustomChannel' : 'myChannelId',
  // for wsrelay you'd pass nodeId here
);
```

## Differences between transports

The widget API is identical. The differences:

| | MQTT | OPC UA relay |
|---|---|---|
| Subscription identifier | topic name (with prefix) | `id` (browser-chosen) + `nodeId` |
| Payload format | strings | typed (Boolean/Byte/REAL/etc) |
| Button writes | publishes string | writes typed value via relay |
| Reconnect-and-resync | done by Paho | done by relay's `ready` message |

For MQTT, the convention is that channel name `running` becomes topic
`<prefix>/running`. For relay, there's no prefix; the channel name is just
a label, and the `nodeId` does the actual addressing.

## Examples

See `examples/`:

- `minimal.html` — simplest possible usage (1 lamp, 1 button)
- `stoplight.html` — the demo, rebuilt on the lib in ~30 lines
- `dashboard.html` — multi-widget layout
