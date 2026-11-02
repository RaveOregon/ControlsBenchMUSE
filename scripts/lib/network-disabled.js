// Offline response-replay preload: fail before Node can open any network connection.
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const denied = () => { throw new Error("Networking disabled for recorded Wonder replay"); };
globalThis.fetch = async () => denied();
net.connect = net.createConnection = net.Socket.prototype.connect = denied;
tls.connect = http.request = http.get = https.request = https.get = denied;
dgram.createSocket = dns.lookup = dns.resolve = denied;
syncBuiltinESMExports();
