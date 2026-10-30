# Browser side — building the HMI

## What goes on the browser side

A single static HTML file. It loads a JavaScript MQTT client over WebSocket,
subscribes to topics published by the PLC, and renders state. User interactions
publish to "command" topics that the PLC subscribes to.

No build step required. Just an HTML file with inline `<style>` and `<script>`,
and a CDN-loaded MQTT library. Open it locally with `file://` or serve it
from any static host.

## The MQTT-over-WebSocket library

We use **Paho.js** (Eclipse Paho MQTT JavaScript client). It's the most
common browser MQTT library; battle-tested, small, no build step needed.

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.0.1/mqttws31.min.js"></script>
```

If you want a more modern alternative, `mqtt.js` works too — it has a
slightly nicer API. But Paho is the safer default.

## Skeleton client code

```javascript
const HOST = 'localhost';
const PORT = 9001;            // Mosquitto WebSocket listener
const PATH = '/';
const CLIENT_ID = 'browser-' + Math.random().toString(36).slice(2, 10);

const client = new Paho.MQTT.Client(HOST, PORT, PATH, CLIENT_ID);

client.onConnectionLost = function (resp) {
    console.warn('lost:', resp.errorMessage);
    setTimeout(connect, 2000);  // simple auto-reconnect
};

client.onMessageArrived = function (msg) {
    const topic = msg.destinationName;
    const payload = msg.payloadString;  // for text payloads
    handle(topic, payload);
};

function connect() {
    client.connect({
        onSuccess: function () {
            // Subscribe to all the topics you want to render
            client.subscribe('plc/foo');
            client.subscribe('plc/bar');
        },
        onFailure: function (e) {
            console.error('connect failed:', e.errorMessage);
            setTimeout(connect, 2000);
        },
        timeout: 5,
        keepAliveInterval: 30,
        cleanSession: true,
    });
}

function handle(topic, payload) {
    switch (topic) {
        case 'plc/foo':
            document.getElementById('foo').textContent = payload;
            break;
        case 'plc/bar':
            document.getElementById('bar').classList.toggle('on', payload === 'true');
            break;
    }
}

connect();
```

## Sending commands to the PLC

```javascript
function publish(topic, payload) {
    if (!client.isConnected()) return;
    const m = new Paho.MQTT.Message(payload);
    m.destinationName = topic;
    m.qos = 0;
    m.retained = false;
    client.send(m);
}

document.getElementById('startbtn').addEventListener('click', () => {
    publish('plc/command/start', '1');
});
```

## Visual rendering

This is where you can be as fancy as you want. CSS does most of the work for
indicators, lamps, gauges. A few patterns:

### Glowing lamp

```css
.lamp {
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%,
        rgba(255,255,255,0.18), var(--off-color) 60%, #000);
    box-shadow: inset 0 -8px 16px rgba(0,0,0,0.6);
    transition: background 0.35s ease, box-shadow 0.35s ease;
}
.lamp.on.red {
    background: radial-gradient(circle at 30% 30%, #fff, #ff2d2d 60%, #1a0000);
    box-shadow:
        0 0 60px 8px rgba(255,45,45,0.7),
        0 0 120px 12px rgba(255,45,45,0.35),
        inset 0 -8px 16px rgba(0,0,0,0.4);
}
```

JavaScript flips `lamp.on / lamp.off` and adds the color class.

### Smooth value-change animation

For a numeric readout that updates frequently, animate it instead of
flickering:

```css
.value {
    transition: transform 0.2s ease, color 0.2s ease;
}
.value.changed {
    transform: scale(1.05);
    color: var(--accent);
}
```

```javascript
function setValue(id, val) {
    const el = document.getElementById(id);
    el.textContent = val;
    el.classList.add('changed');
    setTimeout(() => el.classList.remove('changed'), 200);
}
```

### Connection indicator

Make the connection state visible, but unobtrusive:

```css
.conn-pill {
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.8rem;
}
.conn-pill.ok  { background: rgba(56,176,0,0.18); color: #7fdd5a; }
.conn-pill.bad { background: rgba(239,35,60,0.18); color: #ff8a8a; }
```

Place inside the side panel, not as a fixed banner — banners cover content.

## Common snags

| Symptom | Cause |
|---|---|
| `WebSocket connection failed` in the browser console | Mosquitto's WebSocket listener (port 9001) isn't running. Verify with `Get-NetTCPConnection -LocalPort 9001` |
| `Paho is not defined` | Library script tag failed to load. Check the CDN URL; try a local copy |
| Browser connects but no messages arrive | You forgot to `subscribe` to the topic, or the topic name is misspelled. Use `mosquitto_sub -t "#"` to see what's actually being published |
| Browser receives messages but nothing renders | `onMessageArrived` not wired up, or `handle()` switch doesn't match the actual topic name |
| Stale value when refreshing the page | The PLC publisher needs `xRetain := TRUE` for state-style signals |
| Page works on `file://` but not when served from a different host | CORS / mixed-content. If your page is on `https://`, the WS connection has to be `wss://` (TLS) |
| `Mixed Content` error in browser | Same — `https://` pages can't open `ws://` connections |
| Messages duplicate or out of order | QoS 0 doesn't guarantee delivery; if you see this, you're probably hitting a different bug |

## Testing without the PLC

You don't need the PLC to develop the browser side. Use `mosquitto_pub` to
fake messages from the command line:

```powershell
& "C:\Program Files\mosquitto\mosquitto_pub.exe" -h localhost -t "plc/foo" -m "hello" -r
```

The `-r` flag makes the message retained, so a browser that subscribes
later still sees it. Same effect as the PLC publishing with `xRetain := TRUE`.

You can iterate on the page UI with this loop:
1. Edit HTML/CSS/JS.
2. Hard-refresh browser (`Ctrl+F5`).
3. From PowerShell, publish test values to drive the UI through its states.

## Hosting

For development: just open the `.html` file in your browser. `file://` works.

For sharing on the local network: any static file server. Examples:
- Python: `python -m http.server 8000` in the folder, then
  `http://<your-ip>:8000/stoplight.html` from any device on the network.
- Node: `npx http-server`.
- IIS / nginx if you want it permanent.

For production: serve over HTTPS (so the WebSocket can be `wss://` for TLS).
This requires a TLS-capable broker config and a real cert. Out of scope for
this recipe.
