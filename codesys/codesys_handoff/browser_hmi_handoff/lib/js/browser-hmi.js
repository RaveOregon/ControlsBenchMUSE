/* AmznBrowserHmi — browser-side library v0.1
 *
 * Single-file JS that gives you declarative widgets bound to live PLC
 * values, working over either:
 *   - MQTT-over-WebSocket (using Paho, loaded externally)
 *   - WebSocket relay (talks to relay.js, no external lib needed)
 *
 * Usage:
 *
 *   const hmi = new BrowserHmi({
 *     transport: 'mqtt',         // or 'wsrelay'
 *     host: 'localhost',
 *     port: 9001,                // 9001 for MQTT-WS, 9876 for our relay
 *     topicPrefix: 'plant/line1' // MQTT only; prefix prepended to widget topics
 *   });
 *
 *   hmi.lamp('running',  '#lamp-1');
 *   hmi.numeric('speed', '#speed-readout', { format: '%.2f' });
 *   hmi.button('cmd/start', '#btn-start', { value: '1' });
 *   hmi.text('state',    '#state-label');
 *   hmi.indicator('faulted', '#fault-pill', { onText: 'FAULT', offText: 'OK' });
 *
 *   hmi.connect();
 *
 * For Paho MQTT, include this in your HTML BEFORE this file:
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.0.1/mqttws31.min.js"></script>
 *
 * For the WebSocket relay transport, no external lib is needed.
 */

(function (root) {
  'use strict';

  // ------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------

  function $(sel) {
    if (typeof sel === 'string') return document.querySelector(sel);
    return sel;
  }

  function fmt(template, value) {
    // Tiny printf-style formatter supporting %f, %.Nf, %d, %s
    if (!template) return String(value);
    return template.replace(/%(\.\d+)?[fdis]/g, (m) => {
      if (m.endsWith('s') || m.endsWith('i') || m.endsWith('d')) {
        return String(value);
      }
      const dot = m.match(/\.(\d+)/);
      const digits = dot ? Number(dot[1]) : 2;
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(digits) : String(value);
    });
  }

  function isTrue(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number')  return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'on';
    }
    return Boolean(v);
  }

  // ------------------------------------------------------------------
  // Transports
  // ------------------------------------------------------------------

  // MQTT over WebSocket via Paho.
  function MqttTransport(opts) {
    if (typeof Paho === 'undefined' || !Paho.MQTT) {
      throw new Error('BrowserHmi: MQTT transport requires Paho. Include mqttws31.min.js before browser-hmi.js.');
    }
    const clientId = 'browser-' + Math.random().toString(36).slice(2, 10);
    const client = new Paho.MQTT.Client(opts.host, Number(opts.port), opts.path || '/', clientId);
    let onValue = null;
    let onStatus = () => {};
    const subs = new Set();

    client.onConnectionLost = (resp) => {
      onStatus(false, 'connection lost: ' + (resp.errorMessage || 'unknown'));
      setTimeout(connect, 2000);
    };
    client.onMessageArrived = (msg) => {
      if (onValue) onValue(msg.destinationName, msg.payloadString);
    };

    function connect() {
      onStatus(false, 'connecting…');
      try {
        client.connect({
          onSuccess: () => {
            onStatus(true, 'connected');
            for (const t of subs) client.subscribe(t);
          },
          onFailure: (e) => {
            onStatus(false, 'connect failed: ' + (e.errorMessage || 'unknown'));
            setTimeout(connect, 2000);
          },
          timeout: 5,
          keepAliveInterval: 30,
          cleanSession: true,
          userName: opts.userName,
          password: opts.password,
          useSSL: !!opts.tls,
        });
      } catch (e) {
        onStatus(false, 'connect error: ' + e.message);
        setTimeout(connect, 2000);
      }
    }

    return {
      kind: 'mqtt',
      connect,
      onValue: (cb) => { onValue = cb; },
      onStatus: (cb) => { onStatus = cb; },
      subscribe: (topic) => {
        subs.add(topic);
        if (client.isConnected()) client.subscribe(topic);
      },
      publish: (topic, payload, opts2) => {
        if (!client.isConnected()) return false;
        const m = new Paho.MQTT.Message(String(payload));
        m.destinationName = topic;
        m.qos = (opts2 && opts2.qos) || 0;
        m.retained = (opts2 && opts2.retained) || false;
        client.send(m);
        return true;
      },
    };
  }

  // WebSocket relay (talks to relay.js).
  function WsRelayTransport(opts) {
    const url = 'ws://' + opts.host + ':' + opts.port + (opts.path || '');
    let ws = null;
    let onValue = null;
    let onStatus = () => {};
    // For the relay, "subscriptions" are tracked by id. Caller passes nodeId
    // separately (no topic prefix). We map id -> nodeId.
    const subs = new Map();

    function connect() {
      onStatus(false, 'connecting to ' + url + ' …');
      try {
        ws = new WebSocket(url);
      } catch (e) {
        onStatus(false, 'cannot create WS: ' + e.message);
        setTimeout(connect, 2000);
        return;
      }
      ws.onopen = () => onStatus(true, 'connected');
      ws.onclose = () => {
        onStatus(false, 'disconnected; reconnecting…');
        setTimeout(connect, 2000);
      };
      ws.onerror = () => { /* close follows */ };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); }
        catch { return; }
        if (msg.type === 'ready') {
          // Resubscribe everything.
          for (const [id, nodeId] of subs) {
            ws.send(JSON.stringify({ action: 'subscribe', id, nodeId }));
          }
        } else if (msg.type === 'value') {
          if (onValue) onValue(msg.id, msg.value);
        }
      };
    }

    return {
      kind: 'wsrelay',
      connect,
      onValue: (cb) => { onValue = cb; },
      onStatus: (cb) => { onStatus = cb; },
      subscribe: (id, nodeId) => {
        subs.set(id, nodeId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'subscribe', id, nodeId }));
        }
      },
      publish: (channel, payload, opts2) => {
        // For relay, "publish" is "write": payload is the value, opts2 must
        // include nodeId and dataType.
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        if (!opts2 || !opts2.nodeId) {
          console.warn('wsrelay publish requires opts.nodeId');
          return false;
        }
        ws.send(JSON.stringify({
          action: 'write',
          id: channel,
          nodeId: opts2.nodeId,
          value: payload,
          dataType: opts2.dataType || 'Boolean',
        }));
        return true;
      },
    };
  }

  // ------------------------------------------------------------------
  // BrowserHmi
  // ------------------------------------------------------------------

  function BrowserHmi(config) {
    config = config || {};
    const transport = config.transport || 'mqtt';
    const topicPrefix = (config.topicPrefix || '').replace(/\/+$/, '');

    const t = transport === 'mqtt'
      ? MqttTransport(config)
      : transport === 'wsrelay'
        ? WsRelayTransport(config)
        : (() => { throw new Error('Unknown transport: ' + transport); })();

    // Per-channel handlers: channel name -> [{type, el, opts}]
    const handlers = new Map();

    function fullTopic(name) {
      // For MQTT, prepend the prefix; for relay, the "channel" is just the id.
      if (t.kind === 'mqtt') {
        if (!topicPrefix) return name;
        return topicPrefix + '/' + name.replace(/^\/+/, '');
      }
      return name;
    }

    t.onValue((channelOrTopic, payload) => {
      // For MQTT, we need to strip the prefix to find the channel.
      let channel = channelOrTopic;
      if (t.kind === 'mqtt' && topicPrefix && channelOrTopic.startsWith(topicPrefix + '/')) {
        channel = channelOrTopic.slice(topicPrefix.length + 1);
      }
      const list = handlers.get(channel);
      if (!list) return;
      for (const h of list) {
        try { h.update(payload); }
        catch (e) { console.error('widget update failed', h, e); }
      }
    });

    let statusCb = null;
    t.onStatus((ok, msg) => {
      if (statusCb) statusCb(ok, msg);
    });

    function register(channel, opts, update) {
      // For wsrelay, opts must include nodeId; subscribe by id.
      // For MQTT, the topic comes from topicPrefix + channel.
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel).push({ update, opts });

      if (t.kind === 'mqtt') {
        const topic = fullTopic(channel);
        t.subscribe(topic);
      } else {
        if (!opts.nodeId) {
          console.warn('wsrelay widget requires opts.nodeId on channel ' + channel);
          return;
        }
        t.subscribe(channel, opts.nodeId);
      }
    }

    // ---- Widgets ----

    function lamp(channel, sel, opts) {
      const el = $(sel);
      if (!el) { console.warn('lamp: element not found', sel); return; }
      opts = opts || {};
      const update = (payload) => {
        const on = isTrue(payload);
        el.classList.toggle('hmi-on',  on);
        el.classList.toggle('hmi-off', !on);
        if (opts.color) el.classList.toggle('hmi-' + opts.color, on);
      };
      register(channel, opts, update);
    }

    function numeric(channel, sel, opts) {
      const el = $(sel);
      if (!el) { console.warn('numeric: element not found', sel); return; }
      opts = opts || {};
      const update = (payload) => {
        el.textContent = fmt(opts.format || '%.2f', payload);
      };
      register(channel, opts, update);
    }

    function text(channel, sel, opts) {
      const el = $(sel);
      if (!el) { console.warn('text: element not found', sel); return; }
      opts = opts || {};
      const update = (payload) => {
        let s = String(payload);
        if (opts.map && opts.map[s] !== undefined) s = opts.map[s];
        el.textContent = s;
      };
      register(channel, opts, update);
    }

    function indicator(channel, sel, opts) {
      const el = $(sel);
      if (!el) { console.warn('indicator: element not found', sel); return; }
      opts = opts || {};
      const onText = opts.onText || 'ON';
      const offText = opts.offText || 'OFF';
      const update = (payload) => {
        const on = isTrue(payload);
        el.textContent = on ? onText : offText;
        el.classList.toggle('hmi-pill-on',  on);
        el.classList.toggle('hmi-pill-off', !on);
      };
      register(channel, opts, update);
    }

    function button(channel, sel, opts) {
      const el = $(sel);
      if (!el) { console.warn('button: element not found', sel); return; }
      opts = opts || {};
      el.addEventListener('click', () => {
        const value = opts.value !== undefined ? opts.value : '1';
        if (t.kind === 'mqtt') {
          t.publish(fullTopic(channel), value, { qos: 0, retained: false });
        } else {
          t.publish(channel, value, { nodeId: opts.nodeId, dataType: opts.dataType || 'Byte' });
        }
        // brief visual nudge
        el.classList.add('hmi-pressed');
        setTimeout(() => el.classList.remove('hmi-pressed'), 120);
      });
    }

    // ---- Status / connection ----

    function onStatus(cb) { statusCb = cb; }

    function connect() { t.connect(); }

    return {
      lamp, numeric, text, indicator, button,
      onStatus, connect,
      // Escape hatches
      _transport: t,
      _handlers: handlers,
    };
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BrowserHmi };
  }
  root.BrowserHmi = BrowserHmi;

})(typeof window !== 'undefined' ? window : globalThis);
