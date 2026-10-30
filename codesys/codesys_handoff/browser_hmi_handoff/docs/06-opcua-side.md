# OPC UA — exposing PLC variables for external tools

This is the alternative to the MQTT bridge in `02-codesys-side.md`. OPC UA is
built into the CODESYS runtime; you don't need a library reference or any POU
code. The browse-and-write workflow with a desktop client (UaExpert,
opcua-commander, etc.) is much faster than the MQTT pattern *if* you only need
a desktop tool. For browser HMIs you still need a relay.

Verified against **CODESYS V3.5 SP22.20** on Windows.

## When to use OPC UA vs the MQTT bridge

See `README.md` and the contrast table — short version:

- **OPC UA** for: bench testing with a desktop tool, exposing many variables
  with no PLC code, anything that integrates with industrial tools (Ignition,
  Kepware, Excel, Wonderware), strong typing on the wire.
- **MQTT bridge** for: custom browser HMIs, multi-PLC consolidation,
  cloud / streaming pipelines, fan-out to many subscribers.

## 1. Add a Symbol Configuration

1. Right-click **Application** under `Device.Plc Logic`.
2. **Add Object → Symbol Configuration…**
3. In the dialog, **check "Support OPC UA features."** This is the part most
   tutorials skip — without it the Symbol Config exists but won't expose
   variables to OPC UA clients.
4. Click Add. A `Symbols` (or "Symbol Configuration") object appears under
   Application.

## 2. Pick the variables to expose

1. Double-click the `Symbols` object.
2. The variable tree mirrors the project: PLC_PRG, GVLs, FB instances.
3. Tick the checkboxes for the variables you want exposed.
4. The rightmost column has **access rights**: leave outputs read-only, set
   inputs you want to manipulate to read+write.

For our stoplight project:

| Variable | Access |
|---|---|
| `PLC_PRG.byDigInByte` | read/write |
| `PLC_PRG.byDigOutByte` | read |
| `PLC_PRG.rAnaInReal` | read |
| `PLC_PRG.rAnaOutReal` | read/write |
| `PLC_PRG.xDigInBool` | read/write |
| `PLC_PRG.xDigOutBool` | read |
| `StopLight.qRed` / `qYellow` / `qGreen` | read |
| `StopLight.qState` | read |

## 3. Configure security so a client can actually connect

⚠ **The most important step, and the one that ate our time the first run.**

CODESYS's OPC UA server has *three* layers of security gating, and a default
install rejects anonymous connections.

### Where the toggles live

Open the device editor: **double-click `Device`** (the topmost device node,
type `CODESYS Control Win V3 x64`). The editor's main pane has a settings
area with a drop-down sub-menu. Drill into:

**Device → Settings (drop-down) → Security Settings**

That's the path that worked on V3.5 SP22.20 — the menu naming may differ
slightly across SP versions, but the toggles you're looking for are always
labelled around "security policy" and "user token policy" / "anonymous."

What you're looking for: a tab that lists **endpoints**, **security policies**
(None / Basic256Sha256 / Aes128_Sha256_RsaOaep), and **user token policies**
(Anonymous / UserName / Certificate).

### What to enable for a sandbox

For test / lab use:

- **Security policies** → enable **None** (in addition to whatever else is
  checked).
- **User token policies** → enable **Anonymous**.
- **Activate / Enable OPC UA server** → ensure it's on.

For production: leave None disabled, require Basic256Sha256 + UserName, set
up TLS certs properly. Out of scope for this recipe.

### Make the changes take effect

OPC UA endpoint changes don't apply on a regular online change. You need to
restart the runtime, not just the application:

1. Save the changes in CODESYS.
2. **Stop the application** (Online → Stop).
3. **Logout** of the PLC.
4. Find the **CODESYS Control** icon in the Windows system tray (near the
   clock; may be hidden under the `^` chevron). Right-click → **Stop PLC**.
5. Right-click again → **Start PLC**.
6. Build (`Ctrl+B`), login, download fresh, start (`F5`).

After this, the OPC UA endpoint will accept the security policy / user token
policy you enabled.

## 4. Connect with a client

### opcua-commander (terminal, npm-installable)

```powershell
npm install -g opcua-commander
opcua-commander -e opc.tcp://localhost:4840
```

If it errors with `Cannot find ANONYMOUS user token policy in end point
description`, the server isn't accepting anonymous yet — re-check section 3.

If it complains about credentials, try with explicit username:

```powershell
opcua-commander -e opc.tcp://localhost:4840 --userName <user> --password <pass>
```

### UaExpert (desktop, commercial-grade browser)

Download from <https://www.unified-automation.com/products/development-tools/uaexpert.html>
(free for non-commercial, account signup required, ~50 MB).

In UaExpert: Server menu → Add → Custom Discovery → enter
`opc.tcp://localhost:4840`. Pick the discovered endpoint, choose security
policy "None" + "Anonymous" (or your credentialed equivalent). Connect. The
address space appears.

### Other clients

- **Prosys OPC UA Browser** — desktop, similar to UaExpert.
- **Prosys OPC UA Web Client** — web-based, hosted variant.
- **node-red** with opcua nodes — drag-and-drop dashboards.
- **Python `asyncua`** / **Node `node-opcua`** — write your own scripts.

## 5. Find your variables

The CODESYS server's address space has a deep path; navigate down:

```
Objects
└── DeviceSet
    └── CODESYS Control Win V3 x64
        └── Resources
            └── Application
                └── (your POUs / GVLs)
```

Inside `Application` you'll see one folder per POU/GVL — `PLC_PRG`,
`StopLight`, etc. — each containing the variables you ticked in section 2.
The exact intermediate folders ("GlobalVars", "Programs") vary between
runtime versions.

If `Application` is empty:
- You ticked variables in the Symbol Config but didn't rebuild → rebuild and
  redownload.
- Or the Symbol Config was created without "Support OPC UA features" checked.
  Check its properties.

If you don't see `Objects → DeviceSet` at all, your client may not be browsing
deeply enough; in opcua-commander, walk into the tree pane (Tab to focus) and
press Right-arrow / Enter on each node.

## 6. Subscribe and write

In opcua-commander:

| Key | Action |
|---|---|
| `Tab` | Switch panes |
| `↑` `↓` | Move within a tree |
| `→` / `Enter` | Expand a node |
| `←` | Collapse / go up |
| `m` | Subscribe (monitor) the highlighted variable; appears in lower pane |
| `w` | Write a value to the highlighted variable |
| `q` | Quit |

In UaExpert:

- Drag a variable from the address space to the **Data Access View** tab.
- Right-click → **Subscribe Data Change** for periodic updates.
- Right-click → **Write** to set a value.

## 7. Adding a variable later

The whole reason this pattern beats the MQTT bridge for "drop-in for testing":

1. Open `Symbols`.
2. Tick a new box.
3. Build + download.
4. Reconnect / re-browse the client.

No POU edit, no broker config, no JSON schema, no relay restart.

## Pitfalls

| Symptom | Fix |
|---|---|
| `Cannot find ANONYMOUS user token policy` | Server isn't accepting anonymous. Enable "Anonymous" user token policy in **Device → Security Settings**, restart the runtime |
| `Endpoint security policy not supported` | Your client picked a policy the server doesn't have. Enable "None" on the server for sandbox, or pick a policy the server does support |
| Address space empty under Application | Symbols object missing OPC UA support, or you didn't rebuild + redownload after ticking variables |
| Cannot find variables but tree is full of "Server", "DeviceSet", etc. | Variables are deeper — walk into `DeviceSet → CODESYS Control... → Resources → Application` |
| Settings change but client still gets old behavior | Online change didn't apply OPC UA endpoint changes. Stop the application, stop the runtime via system tray, restart the runtime, redownload |
| `User token rejected` after providing credentials | The PLC's User Management doesn't have that user, or the password is wrong. Default Administrator/Administrator works on some installs but is changed on others |

## Notes for production

For real plants:

- Disable Anonymous, disable security policy None.
- Require Basic256Sha256 and UserName at minimum.
- Configure proper certs (the runtime auto-generates a self-signed one; for
  production, replace with a CA-issued cert).
- Use the `User Management` object under Application to define users with
  appropriate permissions.
- Audit which variables you expose — anything readwrite is a write to a
  running PLC. Granular per-variable access is your friend.
