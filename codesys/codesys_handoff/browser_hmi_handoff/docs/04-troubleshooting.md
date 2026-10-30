# Troubleshooting

The full list of dead ends we hit, with the fix and how to spot them.

## Diagnostic chain (in order)

When the lamps don't light up, work down the chain. Don't skip steps.

### 1. Is the broker even there?

```powershell
sc.exe query mosquitto
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 1883,9001 }
```

You want both the service `RUNNING` and both ports listening.

### 2. Is the PLC publishing?

This is the single most useful check. In a PowerShell window:

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "#" -v
```

Leave it running. With the PLC in RUN, you should see messages flowing
within a few seconds (every state change publishes one).

- **Messages flowing** → PLC side is fine, problem is browser-side.
- **Silent** → PLC isn't publishing. Continue to step 3.

### 3. Is the PLC connecting to the broker?

In CODESYS, with the PLC logged in and running, open `Mqtt_Bridge` in
monitor view. Look at:

- `client.xConnectedToBroker` → should be `TRUE`. If `FALSE`, see step 4.
- `_connected` → mirrors the above.

### 4. Why isn't the PLC connecting?

Most common causes, in order:

- **`xEnable := TRUE` was forgotten** on the `MQTTClient` call. Without it,
  the FB stays idle. This is the silent killer — no error, just nothing.
- **Wrong host**: If your broker is on a different machine, `sHost` should
  be that machine's IP, not `127.0.0.1`.
- **Wrong port**: PLC uses TCP 1883, not 9001 (9001 is for browsers).
- **Broker firewalled**: If broker isn't on the same machine as the PLC,
  Windows Firewall may block 1883. Allow it inbound.
- **Broker config rejected by parser**: A typo in `mosquitto.conf` makes
  Mosquitto fall back to defaults (single localhost listener). Stop the
  service and run it in foreground for full output:
  `& "C:\Program Files\mosquitto\mosquitto.exe" -c "C:\Program Files\mosquitto\mosquitto.conf" -v`
  Then read the output.

### 5. Is the browser connecting?

In the browser, the connection pill should say `connected`. If it says
`disconnected` / `connect failed`, open the dev console (F12) → Console tab.
Look for WebSocket errors.

- **`WebSocket connection to 'ws://localhost:9001/' failed`** — Mosquitto's
  WS listener isn't up. Recheck step 1.
- **`Paho is not defined`** — the library CDN didn't load. Check Network tab.
- **`Mixed Content` error** — page is HTTPS, ws:// blocked. Use http:// or
  configure TLS.
- **No errors but pill stays on disconnected** — Paho's connect callback
  isn't firing. Check `client.connect({...})` arguments.

### 6. Is the browser subscribed to the right topics?

In the browser dev console:

```javascript
// Subscribe to everything (only for debugging)
client.subscribe('#');
client.onMessageArrived = (m) => console.log(m.destinationName, '=>', m.payloadString);
```

If you see messages arriving with topic names that don't match what `handle()`
is switching on, fix the topic names.

## Specific issues we hit

### "It compiles but nothing happens at runtime"

99% of the time: forgot `xEnable := TRUE` on the MQTTClient FB.

### "String variable too short for VAR_IN_OUT parameter"

Topic strings declared as `WSTRING(64)` or any size other than 1024.
The library's `VAR_IN_OUT` declares topics as `WSTRING(1024)` and the type
checker requires exact size match for VAR_IN_OUT (because they're
pointer-passed and size mismatches would corrupt memory).

Fix: declare all topic strings as `WSTRING(1024)`.

### Static analyzer "expression always FALSE"

The CODESYS dataflow checker, set strict by default, raises errors on
expressions like `client.xConnectedToBroker` because it can't prove the FB
will modify them at runtime. False positive — the program runs fine.

Fix attempts:
- Pragma `{attribute 'analysis' := '-33,-11'}` at POU header. Sometimes
  works, sometimes doesn't depending on version.
- Verify with full compile: `check_for_errors(compile=true)`. If full
  compile passes, the precompile errors are spurious and the PLC will run.
- Or dial down the project-level Static Analysis settings (`Build → Static
  Analysis → Configuration`) — promote those checks from Error to Warning.

### "Cognitive Complexity > 20"

The complexity check fires on POUs with too many branches/calls. The
`Mqtt_Bridge` POU naturally hits this because it has lots of "if changed,
publish" blocks.

Fix:
- Pragma `{attribute 'analysis' := '-26'}` to suppress that check on this POU.
- Or break the bridge into multiple methods (one per published value).

### "Read access to output variable 'qConnected'"

CODESYS treats VAR_OUTPUT as write-only inside the POU.

Fix: keep a private `_connected : BOOL`, write to it freely, then assign
`qConnected := _connected;` at the end.

### Mosquitto config file edit denied

Three layers of friction:
1. The Mosquitto service has the file open while running. Stop the service
   first.
2. `Program Files` requires admin. Use elevated PowerShell.
3. Some installs still refuse writes even with admin + service stopped.
   Workaround: put the config in `C:\ProgramData\mosquitto\` and reconfigure
   the service binPath to point there. See `01-broker-setup.md`.

### `sc query` command does nothing

PowerShell aliases `sc` to `Set-Content`. Use `sc.exe`.

### Browser shows old version after editing HTML

Browser caching. Use `Ctrl+F5` (hard reload) instead of plain refresh.

### Lamp colors look wrong / unchanged

If you're using CODESYS Visu lamps (not custom HTML), per-element colors
aren't scriptable through the script-engine API. Set them by hand in the
IDE or use the browser-side custom HMI. (See
`../../codesys_project_notes/CODESYS_VISU_SCRIPTING_LEARNINGS.md` for full
details on what's reachable / what isn't.)
