# Cheatsheet

The 12 commands you'll need most. Copy/paste ready.

## Mosquitto (MQTT path)

```powershell
# Check the service is running.
sc.exe query mosquitto

# Restart after editing the config.
Restart-Service mosquitto

# Watch every message flowing on the bus.
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "#" -v

# Publish a fake value (handy when the PLC is off but you want the browser
# to render something).
& "C:\Program Files\mosquitto\mosquitto_pub.exe" -h localhost -t "plc/stoplight/red" -m "true" -r

# Confirm the WebSocket port (9001) is listening — the browser uses this.
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq 9001 }
```

The Mosquitto config lives at `C:\Program Files\mosquitto\mosquitto.conf`
and needs both listeners:

```
listener 1883
allow_anonymous true

listener 9001
protocol websockets
```

## OPC UA path

```powershell
# Install the Node deps for the relay.
cd .\opcua_relay
npm install

# Discover node IDs from the running PLC and dump to nodeids.json.
# (Update the variable list inside dump_nodeids.js if you want different ones.)
node dump_nodeids.js

# Run the relay (foreground; Ctrl+C to stop).
node relay.js

# Browse the OPC UA server with a terminal client.
opcua-commander -e opc.tcp://localhost:4840

# Confirm the OPC UA server is up.
Test-NetConnection localhost -Port 4840

# Kill any zombie node processes that might be holding the relay's port.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Format-Table ProcessId, CommandLine -Wrap
# then pick a PID and:
Stop-Process -Id <pid> -Force
```

## Serving the HTML pages

When `file://` won't talk to `ws://localhost`, serve via HTTP:

```powershell
cd .\opcua_relay
npx --yes http-server -p 8090 -c-1 .

# Then visit:
#   http://localhost:8090/stoplight_opcua.html
```

The MQTT page in `stoplight/` works fine via `file://` in most browsers
because Paho is being friendlier than the WebSocket API; if it doesn't,
serve it the same way:

```powershell
cd .\stoplight
npx --yes http-server -p 8091 -c-1 .
```

## CODESYS quick keys

| Key | Action |
|---|---|
| `Ctrl+B` | Build / generate code |
| `Alt+F8` | Login to PLC |
| `F5` | Start application |
| `Ctrl+F8` (or via menu) | Logout |
| `Ctrl+F9` (or via menu) | Stop application |

For OPC UA endpoint setting changes to take effect, the *runtime* itself
(not just the application) needs to restart. Right-click the CODESYS
Control icon in the system tray → **Stop PLC** → wait → **Start PLC**.
Then re-login and download.

## Common port map

| Port | Used for |
|---|---|
| 1883 | Mosquitto MQTT (TCP, for PLC) |
| 4840 | CODESYS OPC UA server |
| 8080 | CODESYS WebVisu (default) |
| 8090 | http-server for our HTML files |
| 9001 | Mosquitto MQTT-over-WebSocket (for browser) |
| 9876 | Our OPC UA → WebSocket relay |
