// Machine-map validator and generator for the ControlsBench Core raw-bank profile.
//
//   node cb-map.mjs validate [map.json ...]   validate maps (default: all in mappings/)
//   node cb-map.mjs generate [map.json ...]   write ST wrappers and manifests
//   node cb-map.mjs check [map.json ...]      fail if committed outputs differ from a fresh generation
//
// The generated ST is a deterministic function of the map. The PLC carries only
// wire identities (SchemaId, TapSchemaId); the complete map hash and the separately
// versioned engineering metadata live in the generated manifest.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const GENERATOR_VERSION = '0.1.0';
export const MAP_FORMAT = 'controlsbench.machine-map/0.1';
export const MANIFEST_FORMAT = 'controlsbench.machine-map-manifest/0.1';
export const PROFILE = 'controlsbench.codesys.raw-banks/0.2';

const LIBRARY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPACITY = { Digital: 64, Signed: 32, Unsigned: 32, RealValue: 16 };
const TYPES = {
  BOOL: { bank: 'Digital', bits: 1 },
  SINT: { bank: 'Signed', bits: 8, pack: 'SINT_TO_DINT', unpack: 'DINT_TO_SINT' },
  INT: { bank: 'Signed', bits: 16, pack: 'INT_TO_DINT', unpack: 'DINT_TO_INT' },
  DINT: { bank: 'Signed', bits: 32 },
  USINT: { bank: 'Unsigned', bits: 8, pack: 'USINT_TO_UDINT', unpack: 'UDINT_TO_USINT' },
  UINT: { bank: 'Unsigned', bits: 16, pack: 'UINT_TO_UDINT', unpack: 'UDINT_TO_UINT' },
  UDINT: { bank: 'Unsigned', bits: 32 },
  BYTE: { bank: 'Unsigned', bits: 8, pack: 'BYTE_TO_UDINT', unpack: 'UDINT_TO_BYTE' },
  WORD: { bank: 'Unsigned', bits: 16, pack: 'WORD_TO_UDINT', unpack: 'UDINT_TO_WORD' },
  DWORD: { bank: 'Unsigned', bits: 32, pack: 'DWORD_TO_UDINT', unpack: 'UDINT_TO_DWORD' },
  REAL: { bank: 'RealValue', bits: 32 },
};
// Explicitly unsupported by this profile: rejected, never narrowed or omitted.
const UNSUPPORTED = ['LINT', 'ULINT', 'LWORD', 'LREAL', 'TIME', 'LTIME', 'DATE', 'TOD', 'DT', 'STRING', 'WSTRING'];
const TAP_ROLES = ['pid.setpoint', 'pid.processVariable', 'pid.output', 'pid.mode', 'internal'];
const IEC_ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED = new Set(['IN', 'OUT', 'AND', 'OR', 'XOR', 'NOT', 'MOD', 'IF', 'THEN', 'ELSE', 'END_IF', 'FOR', 'TO', 'DO',
  'WHILE', 'REPEAT', 'UNTIL', 'CASE', 'OF', 'RETURN', 'EXIT', 'TRUE', 'FALSE', 'VAR', 'END_VAR', 'TYPE', 'STRUCT', 'ARRAY']);

const lf = (text) => text.replace(/\r\n/g, '\n');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint32(value) {
  const n = parseInt(sha256(canonical(value)).slice(0, 8), 16);
  return n === 0 ? 1 : n; // zero is reserved as "unset" by the PLC configuration
}

const hex32 = (n) => `16#${n.toString(16).toUpperCase().padStart(8, '0')}`;

function effectiveBits(ch) {
  return ch.bits ?? TYPES[ch.nativeType].bits;
}

function wireShape(ch, withRole) {
  const shape = { id: ch.id, nativeType: ch.nativeType };
  if (TYPES[ch.nativeType].bank === 'Signed' || TYPES[ch.nativeType].bank === 'Unsigned') shape.bits = effectiveBits(ch);
  if (ch.nativeType === 'REAL') shape.nonFinite = ch.nonFinite ?? 'reject';
  if (withRole) { shape.role = ch.role; shape.loop = ch.loop ?? null; }
  return shape;
}

export function validateMap(map, file = 'map') {
  const errors = [];
  const err = (m) => errors.push(`${file}: ${m}`);
  if (map.format !== MAP_FORMAT) err(`format must be ${MAP_FORMAT}`);
  if (map.profile !== PROFILE) err(`profile must be ${PROFILE}`);
  if (typeof map.mapId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(map.mapId)) err('mapId must be lowercase letters, digits or hyphens (max 31)');
  if (typeof map.mapVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(map.mapVersion)) err('mapVersion must be semantic x.y.z');
  if (typeof map.engineeringVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(map.engineeringVersion)) err('engineeringVersion must be semantic x.y.z');
  if (typeof map.prefix !== 'string' || !/^[A-Z][A-Z0-9]{1,11}$/.test(map.prefix)) err('prefix must be 2-12 uppercase IEC characters');
  const domain = map.domain ?? {};
  if (!Number.isInteger(domain.defaultDomainId) || domain.defaultDomainId < 1 || domain.defaultDomainId > 0xFFFFFFFF) err('domain.defaultDomainId must be a nonzero UDINT');
  if (!Number.isInteger(domain.timeoutUs) || domain.timeoutUs < 1) err('domain.timeoutUs must be a positive integer of microseconds');
  if (!Array.isArray(map.sources) || map.sources.length === 0) err('sources must reference the specification/raw I/O used');
  for (const group of ['inputs', 'outputs', 'taps']) {
    if (!Array.isArray(map[group])) { err(`${group} must be an array`); continue; }
    const ids = new Set();
    const counts = { Digital: 0, Signed: 0, Unsigned: 0, RealValue: 0 };
    for (const [i, ch] of map[group].entries()) {
      const where = `${group}[${i}] ${ch?.id ?? ''}`;
      if (!ch || typeof ch.id !== 'string' || !IEC_ID.test(ch.id) || ch.id.length > 48 || RESERVED.has(ch.id.toUpperCase())) {
        err(`${where}: id must be a non-reserved IEC identifier of at most 48 characters`);
        continue;
      }
      if (ids.has(ch.id.toUpperCase())) err(`${where}: duplicate id (IEC identifiers are case-insensitive)`);
      ids.add(ch.id.toUpperCase());
      if (UNSUPPORTED.includes(ch.nativeType)) { err(`${where}: native type ${ch.nativeType} is unsupported by ${PROFILE}; it needs a later profile, not narrowing`); continue; }
      const t = TYPES[ch.nativeType];
      if (!t) { err(`${where}: unknown native type ${ch.nativeType}`); continue; }
      if (ch.bits !== undefined) {
        if (t.bank !== 'Unsigned') err(`${where}: bits is allowed only for unsigned channels`);
        else if (!Number.isInteger(ch.bits) || ch.bits < 1 || ch.bits > t.bits) err(`${where}: bits must be 1..${t.bits}`);
      }
      if (ch.nonFinite !== undefined && (ch.nativeType !== 'REAL' || !['reject', 'allow'].includes(ch.nonFinite))) err(`${where}: nonFinite is reject|allow and only for REAL`);
      if (ch.writable !== undefined || ch.access !== undefined) err(`${where}: access is defined by the profile, not per channel`);
      if (group === 'taps') {
        if (!TAP_ROLES.includes(ch.role)) err(`${where}: role must be one of ${TAP_ROLES.join(', ')}`);
        if (ch.role?.startsWith('pid.') && (typeof ch.loop !== 'string' || !ch.loop)) err(`${where}: PID taps need a loop identifier`);
      } else if (ch.role !== undefined) err(`${where}: role is only for taps`);
      if (ch.engineering !== undefined && (typeof ch.engineering !== 'object' || Array.isArray(ch.engineering))) err(`${where}: engineering must be an object`);
      counts[t.bank] += 1;
    }
    for (const [bank, n] of Object.entries(counts)) {
      if (n > CAPACITY[bank]) err(`${group}: ${n} ${bank} channels exceed the profile capacity ${CAPACITY[bank]}`);
    }
  }
  return errors;
}

function allocate(channels) {
  const next = { Digital: 0, Signed: 0, Unsigned: 0, RealValue: 0 };
  return channels.map((ch) => {
    const t = TYPES[ch.nativeType];
    return { ...ch, bank: t.bank, index: next[t.bank]++, bits: effectiveBits(ch) };
  });
}

function counts(allocated) {
  const c = { Digital: 0, Signed: 0, Unsigned: 0, RealValue: 0 };
  for (const ch of allocated) c[ch.bank] += 1;
  return c;
}

function bankPath(ch) {
  return ch.bank === 'Digital' ? `Digital[${ch.index}]` : `Numeric.${ch.bank}[${ch.index}]`;
}

function zeroValue(ch) {
  if (ch.nativeType === 'BOOL') return false;
  if (ch.nativeType === 'REAL') return 0.0;
  return 0;
}

const HEADER = (map, what) =>
  `// Generated by codesys/library/scripts/cb-map.mjs ${GENERATOR_VERSION} from mappings/${map.mapId}.map.json; do not edit.\n// ${what}`;

function structText(name, allocated, map, what) {
  const lines = [`TYPE ${name} :`, 'STRUCT'];
  for (const ch of allocated) {
    const width = ch.bank === 'Signed' || ch.bank === 'Unsigned' ? `, ${ch.bits}-bit` : '';
    lines.push(`    ${ch.id} : ${ch.nativeType}; // ${bankPath(ch)}${width}`);
  }
  if (allocated.length === 0) lines.push('    Unused : BOOL; // no channels configured');
  lines.push('END_STRUCT', 'END_TYPE', '');
  return `${lines.join('\n')}`.replace('STRUCT\n', `STRUCT\n    ${HEADER(map, what).split('\n').join('\n    ')}\n`);
}

function packFunction(name, sourceType, allocated, map, what) {
  const lines = [`FUNCTION ${name} : CB.ST_CB_Image`, 'VAR_INPUT', `    Source : ${sourceType};`, 'END_VAR', 'VAR', '    image : CB.ST_CB_Image;', 'END_VAR'];
  lines.push(...HEADER(map, what).split('\n'));
  for (const ch of allocated) {
    const conv = TYPES[ch.nativeType].pack;
    lines.push(`image.${bankPath(ch)} := ${conv ? `${conv}(Source.${ch.id})` : `Source.${ch.id}`};`);
  }
  lines.push(`${name} := image;`, 'END_FUNCTION', '');
  return lines.join('\n');
}

function unpackFunction(name, targetType, allocated, map, what) {
  const lines = [`FUNCTION ${name} : ${targetType}`, 'VAR_INPUT', '    Image : CB.ST_CB_Image;', 'END_VAR', 'VAR', `    values : ${targetType};`, 'END_VAR'];
  lines.push(...HEADER(map, what).split('\n'));
  for (const ch of allocated) {
    const conv = TYPES[ch.nativeType].unpack;
    lines.push(`values.${ch.id} := ${conv ? `${conv}(Image.${bankPath(ch)})` : `Image.${bankPath(ch)}`};`);
  }
  lines.push(`${name} := values;`, 'END_FUNCTION', '');
  return lines.join('\n');
}

export function buildMap(map, mapText) {
  const P = map.prefix;
  const inputs = allocate(map.inputs);
  const outputs = allocate(map.outputs);
  const taps = allocate(map.taps);
  const schemaId = fingerprint32({ profile: map.profile, inputs: map.inputs.map((c) => wireShape(c, false)), outputs: map.outputs.map((c) => wireShape(c, false)) });
  const tapSchemaId = map.taps.length ? fingerprint32({ profile: map.profile, taps: map.taps.map((c) => wireShape(c, true)) }) : 0;
  const engineering = { engineeringVersion: map.engineeringVersion, channels: [...map.inputs, ...map.outputs, ...map.taps].map((c) => ({ id: c.id, engineering: c.engineering ?? null })) };
  const engineeringSha256 = sha256(canonical(engineering));
  const inCounts = counts(inputs);
  const files = {};
  const objects = [];
  const add = (name, text) => { files[`${name}.st`] = text; objects.push(name); };

  add(`GVL_${P}_Map`, [
    "{attribute 'qualified_only'}",
    'VAR_GLOBAL CONSTANT',
    `    ${HEADER(map, 'Wire identities of this machine map.').split('\n').join('\n    ')}`,
    `    MAP_ID : STRING(32) := '${map.mapId}';`,
    `    SCHEMA_ID : UDINT := ${hex32(schemaId)}; // raw input/output channel layout`,
    `    TAP_SCHEMA_ID : UDINT := ${hex32(tapSchemaId)}; // observation tap list; 0 when none`,
    `    DEFAULT_DOMAIN_ID : UDINT := ${map.domain.defaultDomainId};`,
    `    TIMEOUT_US : ULINT := ${map.domain.timeoutUs};`,
    'END_VAR',
    '',
  ].join('\n'));
  add(`ST_${P}_Inputs`, structText(`ST_${P}_Inputs`, inputs, map, 'Raw inputs in native types; the session image carries them losslessly.'));
  add(`ST_${P}_Outputs`, structText(`ST_${P}_Outputs`, outputs, map, 'Application output commands in native types.'));
  if (taps.length) add(`ST_${P}_Taps`, structText(`ST_${P}_Taps`, taps, map, 'Read-only observation taps of internal signals.'));

  const cfg = [`FUNCTION MAP_${P}_Config : CB.ST_CB_Config`, 'VAR_INPUT', '    DomainId : UDINT; // one value per authority domain in the application', 'END_VAR', 'VAR', '    c : CB.ST_CB_Config;', 'END_VAR'];
  cfg.push(...HEADER(map, 'Session configuration for this map.').split('\n'));
  cfg.push('c.DomainId := DomainId;', `c.SchemaId := GVL_${P}_Map.SCHEMA_ID;`, `c.TimeoutUs := GVL_${P}_Map.TIMEOUT_US;`);
  cfg.push(`c.DigitalCount := ${inCounts.Digital};`, `c.SignedCount := ${inCounts.Signed};`, `c.UnsignedCount := ${inCounts.Unsigned};`, `c.RealCount := ${inCounts.RealValue};`);
  for (const ch of inputs) {
    if (ch.bank === 'Signed') cfg.push(`c.SignedBits[${ch.index}] := ${ch.bits}; // ${ch.id}`);
    if (ch.bank === 'Unsigned') cfg.push(`c.UnsignedBits[${ch.index}] := ${ch.bits}; // ${ch.id}`);
    if (ch.bank === 'RealValue') cfg.push(`c.RealNonFiniteAllowed[${ch.index}] := ${(ch.nonFinite ?? 'reject') === 'allow' ? 'TRUE' : 'FALSE'}; // ${ch.id}`);
  }
  cfg.push(`MAP_${P}_Config := c;`, 'END_FUNCTION', '');
  add(`MAP_${P}_Config`, cfg.join('\n'));
  add(`MAP_${P}_PackInputs`, packFunction(`MAP_${P}_PackInputs`, `ST_${P}_Inputs`, inputs, map, 'Raw acquisition into the session hardware image.'));
  add(`MAP_${P}_UnpackInputs`, unpackFunction(`MAP_${P}_UnpackInputs`, `ST_${P}_Inputs`, inputs, map, 'Selected image back to native types; the session has enforced each width.'));
  add(`MAP_${P}_PackOutputs`, packFunction(`MAP_${P}_PackOutputs`, `ST_${P}_Outputs`, outputs, map, 'Authentic commands into an output image for the DO/AO taps.'));
  add(`MAP_${P}_UnpackOutputs`, unpackFunction(`MAP_${P}_UnpackOutputs`, `ST_${P}_Outputs`, outputs, map, 'Physical sink values; configured SuppressedValues must fit each native type.'));
  if (taps.length) add(`MAP_${P}_PackTaps`, packFunction(`MAP_${P}_PackTaps`, `ST_${P}_Taps`, taps, map, 'Observation taps into the frame tap image; no write path exists.'));

  const channel = (ch, direction) => ({
    id: ch.id,
    direction,
    bank: ch.bank,
    index: ch.index,
    nativeType: ch.nativeType,
    ...(ch.bank === 'Signed' || ch.bank === 'Unsigned' ? { bits: ch.bits } : {}),
    ...(ch.nativeType === 'REAL' ? { encoding: 'IEEE754_binary32', nonFinite: ch.nonFinite ?? 'reject' } : {}),
    ...(ch.bank === 'Signed' ? { encoding: `twos_complement_${ch.bits}` } : {}),
    ...(ch.bank === 'Unsigned' ? { encoding: `unsigned_${ch.bits}` } : {}),
    ...(ch.bank === 'Digital' ? { encoding: 'BOOL' } : {}),
    rawZero: zeroValue(ch),
    workstationWrite: direction === 'input' ? 'only_while_simulated_through_complete_slot_commits' : 'never',
    observable: true,
    ...(direction === 'tap' ? { role: ch.role, loop: ch.loop ?? null, source: ch.source ?? null } : {}),
    engineering: ch.engineering ?? null,
  });
  const manifest = {
    format: MANIFEST_FORMAT,
    generatedBy: `codesys/library/scripts/cb-map.mjs ${GENERATOR_VERSION}`,
    mapId: map.mapId,
    mapVersion: map.mapVersion,
    mapFile: `codesys/library/mappings/${map.mapId}.map.json`,
    mapSha256: sha256(lf(mapText)),
    profile: map.profile,
    schemaId: hex32(schemaId),
    schemaIdDecimal: schemaId,
    tapSchemaId: hex32(tapSchemaId),
    tapSchemaIdDecimal: tapSchemaId,
    engineeringVersion: map.engineeringVersion,
    engineeringSha256,
    identityRules: {
      schemaId: 'first 32 bits of SHA-256 over the canonical profile and ordered input/output wire shapes (id, native type, bits, non-finite policy); 0 maps to 1',
      tapSchemaId: 'first 32 bits of SHA-256 over the canonical profile and ordered tap shapes including role and loop; 0 when no taps',
      engineeringSha256: 'SHA-256 over engineeringVersion and per-channel engineering metadata; changes here never change wire identities',
    },
    domain: map.domain,
    sources: map.sources,
    counts: { inputs: inCounts, outputs: counts(outputs), taps: counts(taps) },
    capacities: CAPACITY,
    plcObjects: objects,
    channels: [...inputs.map((c) => channel(c, 'input')), ...outputs.map((c) => channel(c, 'output')), ...taps.map((c) => channel(c, 'tap'))],
    limitations: [
      'Channels are allocated contiguously per bank in declaration order; append new channels to keep existing indices.',
      `Unsupported native types are rejected, not narrowed: ${UNSUPPORTED.join(', ')}. Flatten structures into explicit channels.`,
      'Units, scaling, ranges, polarity and rollover are engineering metadata for workstation/analysis use. The PLC mapping copies raw values and applies none of them.',
      'Taps are observation-only. No request field or library block writes them.',
      'Transport bindings (OPC UA node paths/access rights) are deployment data and are not part of this manifest.',
    ],
  };
  return { files, objects, manifest };
}

function listMaps(args) {
  if (args.length) return args.map((a) => path.resolve(a));
  const dir = path.join(LIBRARY_ROOT, 'mappings');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.map.json')).sort().map((f) => path.join(dir, f));
}

function loadMap(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { text, map: JSON.parse(text) };
}

const generatedDir = (map) => path.join(LIBRARY_ROOT, 'examples', 'mappings', map.mapId);
const manifestPath = (map) => path.join(LIBRARY_ROOT, 'mappings', 'generated', `${map.mapId}.manifest.json`);

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['validate', 'generate', 'check'].includes(command)) {
    console.error('usage: node cb-map.mjs validate|generate|check [map.json ...]');
    process.exit(2);
  }
  const failures = [];
  const summary = [];
  for (const file of listMaps(args)) {
    const { text, map } = loadMap(file);
    const errors = validateMap(map, path.basename(file));
    if (errors.length) { failures.push(...errors); continue; }
    const out = buildMap(map, text);
    const manifestText = `${JSON.stringify(out.manifest, null, 2)}\n`;
    summary.push({ mapId: map.mapId, schemaId: out.manifest.schemaId, tapSchemaId: out.manifest.tapSchemaId, objects: out.objects.length });
    if (command === 'generate') {
      const dir = generatedDir(map);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, body] of Object.entries(out.files)) fs.writeFileSync(path.join(dir, name), body);
      fs.mkdirSync(path.dirname(manifestPath(map)), { recursive: true });
      fs.writeFileSync(manifestPath(map), manifestText);
    } else if (command === 'check') {
      const dir = generatedDir(map);
      const present = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
      const expected = Object.keys(out.files).sort();
      if (canonical(present) !== canonical(expected)) failures.push(`${map.mapId}: generated file set differs (${present.join(',')} vs ${expected.join(',')})`);
      for (const [name, body] of Object.entries(out.files)) {
        const p = path.join(dir, name);
        if (!fs.existsSync(p) || lf(fs.readFileSync(p, 'utf8')) !== body) failures.push(`${map.mapId}: ${name} is stale; run generate`);
      }
      if (!fs.existsSync(manifestPath(map)) || lf(fs.readFileSync(manifestPath(map), 'utf8')) !== manifestText) failures.push(`${map.mapId}: manifest is stale; run generate`);
    }
  }
  console.log(JSON.stringify({ command, status: failures.length ? 'fail' : 'pass', maps: summary, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
