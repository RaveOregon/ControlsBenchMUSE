# Drop-in checklist — adding the bridge to YOUR project

You have an existing CODESYS project. You want to expose some variables
from it for browser-based testing or HMI work. This checklist is the
short version that skips the demo content.

## Decision: MQTT or OPC UA?

| Your situation | Pick |
|---|---|
| Browser-based custom HMI for non-engineers; want polished UI | **MQTT bridge** (POU + Mosquitto + custom HTML) |
| Engineering bench testing of an existing project; minimal PLC code change | **OPC UA + relay** (Symbol Config + Node.js relay + custom HTML) |
| Multi-PLC consolidation, fan-out to many subscribers, cloud streaming | **MQTT bridge** |
| Prefer ticking checkboxes over writing PLC code | **OPC UA + relay** |
| Need to use UaExpert / Excel / Ignition / etc. as well as the browser | **OPC UA + relay** |
| Project ships to production, security/auth matters | **OPC UA + relay** (UA's auth/TLS is mature) |

You can do both at once. They don't conflict.

---

## Path A: MQTT bridge into existing project

Estimated time: 30–60 minutes for first variable; 5 minutes per additional.

### Prerequisites

- [ ] Mosquitto installed locally (or another MQTT broker reachable from
      the PLC). Configure the WebSocket listener — see `01-broker-setup.md`.
- [ ] CODESYS Store **IIoT Libraries SL** package installed.
- [ ] Project has a writable Library Manager (any project does).

### Steps

1. **Add libraries.** Library Manager → Add Library → `MQTT Client SL`.
   (Optionally also `JSON Utilities SL` if you want structured payloads.)

2. **Decide which variables to expose.** List them out. For each, decide:
   - The MQTT topic name (use a hierarchy: `<plant>/<line>/<station>/<signal>`).
   - The QoS (use 0 for telemetry; 1 only if you really need delivery guarantees).
   - Whether to retain (TRUE for state, FALSE for events/edges).
   - Whether the browser will write back (then add a subscribe topic too).

3. **Copy the `Mqtt_Bridge` pattern** from `02-codesys-side.md`. Per
   variable, you need:
   - One `MQTTPublish` instance.
   - A `WSTRING(1024)` topic name (must be exactly 1024 — see pitfalls).
   - A "last value" variable for change detection.
   - A trigger pulse and a payload buffer.
   - One block in the body that detects change → builds payload → sets trigger.

4. **Hook the bridge into a task.** A dedicated comms task at 100ms
   beats running it in MainTask if you have many variables.

5. **Critical settings.**
   - `xEnable := TRUE` on `MQTTClient` and every `MQTTSubscribe`.
   - `WSTRING(1024)` for all topic strings.
   - `pbPayload := ADR(sPayload)` and `udiPayloadSize := TO_UDINT(LEN(sPayload))` for STRING payloads.
   - `xRetain := TRUE` for state-style signals so a fresh browser sees the current value.

6. **Build, login, run.** Verify with the command-line subscriber:
   ```powershell
   & "C:\Program Files\mosquitto\mosquitto_sub.exe" -h localhost -t "your/prefix/#" -v
   ```

7. **Build the browser HMI.** Copy `stoplight/stoplight.html` as a
   starting template. Change:
   - The `subscribe()` calls to your topic names.
   - The `handle()` switch cases to map topic → DOM update.
   - The CSS to your visual.

### Removal checklist (when you're done with the bridge)

- [ ] Remove `Mqtt_Bridge` POU.
- [ ] Remove the program call from MainTask (or wherever it ran).
- [ ] Remove the library reference from Library Manager.
- [ ] Optionally keep the broker config; no harm in leaving Mosquitto
      installed if you want to bring this back later.

---

## Path B: OPC UA + relay against existing project

Estimated time: 15 minutes for first variable; 30 seconds per additional.

### Prerequisites

- [ ] CODESYS runtime supports OPC UA server (most do).
- [ ] Node.js 18+ installed on the engineering machine.

### Steps

1. **Add a Symbol Configuration object.** Right-click Application → Add
   Object → Symbol Configuration. **Check "Support OPC UA features"** in
   the dialog.

2. **Tick variables to expose.** Open the Symbols object, tick boxes
   next to variables, set per-variable access (read / read+write).

3. **Configure security** (sandbox only):
   - Double-click `Device` → drop-down to **Security Settings**.
   - Enable **None** security policy and **Anonymous** user token.
   - Stop application, restart runtime via system tray, redownload.

4. **Verify the server is up.**
   ```powershell
   Test-NetConnection localhost -Port 4840
   ```

5. **Copy the relay folder** (`opcua_relay/` from this handoff) into
   your project's tree. Run:
   ```powershell
   cd opcua_relay
   npm install
   ```

6. **Discover node IDs.** Edit `dump_nodeids.js`'s `WANTED` array to
   include the variable simple-names you ticked. Run:
   ```powershell
   node dump_nodeids.js
   ```
   Output goes to `nodeids.json` and stdout. Note the node ID strings.

7. **Adapt the browser HMI.** Copy `stoplight_opcua.html` as a starting
   template. Update the `VARS` object near the top:
   ```javascript
   const NODE_BASE = 'ns=4;s=|var|<your runtime name>.Application';
   const VARS = {
     mySignal: { id: 'mySignal', nodeId: NODE_BASE + '.MyPou.myVar' },
     // ... etc
   };
   ```

8. **Run the relay**: `node relay.js` — it stays running.

9. **Open the HTML** via `http://localhost:8090/...` after starting
   `npx http-server -p 8090 -c-1 .`. (Direct `file://` open often
   works; HTTP path is the reliable fallback.)

### Removal checklist

- [ ] Optional: delete the Symbol Configuration object (or just untick
      variables you no longer need).
- [ ] Stop the relay process.
- [ ] No PLC code changes were made; nothing else to remove.

---

## Common pitfalls (cross-cutting)

See `04-troubleshooting.md` for the full list. Most-bitten ones:

| Symptom | Fix |
|---|---|
| MQTT bridge silently does nothing | Forgot `xEnable := TRUE` |
| `String variable too short` build error | Topic strings must be `WSTRING(1024)` |
| OPC UA `Cannot find ANONYMOUS user token policy` | Security Settings sub-menu didn't get the right toggle, or runtime needs restart |
| Browser stuck at "connecting…" | Some other process binds the relay's port; check `netstat -ano \| Select-String ":<port>"` |
| `sc query mosquitto` returns nothing | Use `sc.exe`, not `sc` (PowerShell aliases it) |
