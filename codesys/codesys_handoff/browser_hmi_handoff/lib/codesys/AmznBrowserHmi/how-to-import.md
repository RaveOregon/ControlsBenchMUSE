# Importing AmznBrowserHmi into your CODESYS project

Iteration 1 is **source-form**: there's no `.compiled-library` yet, you
copy the `.st` files in. Iteration 2 will package it for the Library
Manager.

## Steps (~3 minutes)

1. **Open your CODESYS project.**

2. **In the project tree, right-click `Application` → Add Object →
   POU**. Set:
   - Name: `FB_MqttHmi` (exactly)
   - Type: **Function Block**
   - Implementation language: **Structured Text**
   - Click **Add**.

3. The editor opens. **Replace the entire content** with the contents of
   `FB_MqttHmi.st` from this folder.

4. Repeat for `FB_OpcUaHmi`:
   - Right-click Application → Add Object → POU → Function Block, ST,
     name `FB_OpcUaHmi`. Paste in `FB_OpcUaHmi.st`.

5. For the enum:
   - Right-click Application → Add Object → DUT → Type: Enumeration,
     name `E_HmiPayloadType`. Paste in `E_HmiPayloadType.st`.

6. **Add the MQTT library reference** if you'll use FB_MqttHmi:
   - Library Manager → Add Library → `MQTT Client SL`. Confirm the
     namespace is `MQTT`.

7. **Build** (`Ctrl+B`). Should be clean. If you see static-analysis
   "always FALSE" warnings, they're false positives from the
   `Mqtt_Bridge` pattern — already suppressed via pragmas.

8. **You're done.** Use the FB in your application code:

```iecst
VAR
    hmi : FB_MqttHmi(
        sHost := '127.0.0.1',
        sTopicPrefix := 'plant/line1');
END_VAR

hmi();
hmi.PublishBool('running', myProgram.xRunning);
```

## What if the namespace `AmznBrowserHmi` doesn't exist?

In iteration 1, the FBs live directly in your application, not in a
namespace. So your code references them by their plain names
(`FB_MqttHmi`, not `AmznBrowserHmi.FB_MqttHmi`).

When iteration 2 packages this as a real library, you'll then write
`AmznBrowserHmi.FB_MqttHmi`. Until then, the simple name works fine.

The library docs and examples sometimes show the namespaced form for
forward compatibility — substitute mentally if you're on iteration 1.

## Updating

When you pull a newer version of these files, just replace your project's
copies with the new content (CODESYS handles online change for additive
edits; for breaking changes, do a full download).

Diff your copy against the source if you customized anything — easy with
the `.st` files since they're plain text.
