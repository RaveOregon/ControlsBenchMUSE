# Broker setup — Mosquitto on Windows

## Why a broker, and why this one

MQTT is a publish/subscribe protocol; the broker is the central post office.
The PLC publishes to topics, browsers (and anything else) subscribe. Mosquitto
is the most common open-source broker, has a Windows installer, runs as a
service, and is small (~3 MB).

Any MQTT broker works (EMQX, HiveMQ, NanoMQ, AWS IoT, Azure IoT, HiveMQ
Cloud). Mosquitto is just the path of least resistance for a learning /
single-PLC setup.

## Install

1. Go to https://mosquitto.org/download/
2. Pick the **Binary Installation → Windows** section. Download
   `mosquitto-X.Y.Z-install-windows-x64.exe` — an `.exe` installer, not the
   ZIP of source code.
3. Run it. Default install location is `C:\Program Files\mosquitto\`.
4. The installer registers Mosquitto as a Windows service that auto-starts.

Confirm the service is running (any PowerShell):

```powershell
sc.exe query mosquitto
```

Should print `STATE : 4 RUNNING`.

> **Quirk**: in PowerShell, `sc query` (without the `.exe`) gets aliased to
> `Set-Content` and silently does nothing. Always use `sc.exe`.

## Default behavior

Out of the box, Mosquitto listens on `127.0.0.1:1883` only and accepts
anonymous connections. That's enough for the PLC to publish but **not** for
the browser, because browsers can only do MQTT-over-WebSocket.

## Add the WebSocket listener

The default config file at `C:\Program Files\mosquitto\mosquitto.conf` is
all comments. We need to add explicit listeners. The file is in Program
Files so editing it requires admin **and** the Mosquitto service must be
stopped (it holds an open file handle while running).

In an **Administrator PowerShell**:

```powershell
Stop-Service mosquitto
Add-Content -Path 'C:\Program Files\mosquitto\mosquitto.conf' -Value @'

# === Added for PLC + browser bridge ===
listener 1883
allow_anonymous true

listener 9001
protocol websockets
'@
Start-Service mosquitto
```

Verify both listeners are up:

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 1883,9001 } | Select-Object LocalAddress,LocalPort
```

You should see both `1883` and `9001` listening on `0.0.0.0` and `::`.

## Smoke-test: pub/sub from the command line

In one PowerShell window (subscriber):

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "test/#" -v
```

In another window (publisher):

```powershell
& "C:\Program Files\mosquitto\mosquitto_pub.exe" -h localhost -t "test/hello" -m "world"
```

Window 1 should print:

```
test/hello world
```

If it does, the broker is functional on TCP. We'll smoke-test the WebSocket
side once the browser HMI is connected.

## Common snags

- **`sc query` returns nothing** → use `sc.exe query` (PowerShell alias issue).
- **`Add-Content` says permission denied** → service is still running, holding
  the file. Stop it first.
- **`Add-Content` still denies even with service stopped** → admin privs
  missing. Use an elevated PowerShell.
- **WebSocket port not listening after restart** → check the config file
  for typos. Run `mosquitto.exe -c <conf> -v` in a foreground window to see
  parse errors.

## Common workaround when Program Files is too locked-down

Some setups refuse to allow writes to `C:\Program Files\mosquitto\` even with
admin. Workaround: keep a config in a writable location and reconfigure the
service to use it.

```powershell
Stop-Service mosquitto
$conf = "C:\ProgramData\mosquitto\mosquitto.conf"
New-Item -ItemType Directory -Path "C:\ProgramData\mosquitto" -Force | Out-Null
Set-Content -Path $conf -Value @'
listener 1883
allow_anonymous true

listener 9001
protocol websockets
'@
sc.exe config mosquitto binPath= "`"C:\Program Files\mosquitto\mosquitto.exe`" run -c `"C:\ProgramData\mosquitto\mosquitto.conf`""
Start-Service mosquitto
```

## Optional: monitor the bus while building

Useful while iterating — leaves a console open showing every message the PLC
publishes:

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "#" -v
```

(`#` is the wildcard for "everything"; `+` matches one level.) Run this in
a background console while developing — you'll see exactly what the PLC is
saying.
