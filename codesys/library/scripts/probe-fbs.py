from __future__ import print_function
# Independent headless probe of the installed CODESYS File-Based Storage API.
# It creates a throwaway library covering every object kind the core uses,
# converts a COPY into a new empty directory, reopens it with fbs.open and
# compiles it. It never opens another user's project or contacts a PLC.
import os, json, shutil, traceback, datetime
from scriptengine import *

system.trace = False
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S-%fZ')
OUT = os.path.join(ROOT, 'artifacts', 'probe-fbs-' + STAMP)
os.makedirs(OUT)
report = {'status': 'failed', 'plcContacted': False, 'stamp': STAMP, 'events': []}

SOURCES = [
    ('ST_ProbeStruct', DutType.Structure, 'TYPE ST_ProbeStruct :\nSTRUCT\n    A : DINT;\n    B : ARRAY[0..3] OF BOOL;\nEND_STRUCT\nEND_TYPE'),
    ('U_ProbeUnion', DutType.Union, 'TYPE U_ProbeUnion :\nUNION\n    AsReal : REAL;\n    AsBits : DWORD;\nEND_UNION\nEND_TYPE'),
]
GVL_TEXT = "{attribute 'qualified_only'}\nVAR_GLOBAL CONSTANT\n    PROBE_VERSION : UDINT := 7;\nEND_VAR"
FB_DECL = 'FUNCTION_BLOCK FB_Probe\nVAR_INPUT\n    In : ST_ProbeStruct;\nEND_VAR\nVAR_OUTPUT\n    Out : DINT;\n    Bits : DWORD;\nEND_VAR\nVAR\n    u : U_ProbeUnion;\nEND_VAR'
FB_IMPL = 'u.AsReal := DINT_TO_REAL(In.A);\nBits := u.AsBits;\nOut := In.A + UDINT_TO_DINT(GVL_Probe.PROBE_VERSION);'
FN_DECL = 'FUNCTION F_Probe : DINT\nVAR_INPUT\n    X : DINT;\nEND_VAR'
FN_IMPL = 'F_Probe := X + 1;'


def messages():
    out = []
    for category in system.get_message_categories():
        for m in system.get_message_objects(category):
            out.append({'severity': str(m.severity), 'text': str(m.text) if hasattr(m, 'text') else str(m)})
    return out


def tree(path):
    files = []
    for base, dirs, names in os.walk(path):
        for n in names:
            full = os.path.join(base, n)
            files.append({'path': os.path.relpath(full, path).replace('\\', '/'), 'bytes': os.path.getsize(full)})
    return sorted(files, key=lambda x: x['path'])


class Handler(NativeImportHandler):
    def conflict(self, name, existingObject, newguid):
        report['events'].append({'conflict': str(name)})
        return NativeImportResolve.cancel

    def progress(self, name, pastedObject, exception):
        if exception is not None:
            report['events'].append({'progressException': str(name), 'exception': str(exception)})

    def skipped(self, name):
        report['events'].append({'skipped': str(name)})


try:
    if projects.primary is not None:
        raise Exception('Probe requires its own empty headless CODESYS process')
    report['globals'] = {k: (k in globals()) for k in ['fbs', 'FBSValidationStatus', 'NativeImportHandler', 'NativeImportResolve']}
    original = os.path.join(OUT, 'FbsProbe.library')
    p = projects.create(original)
    info = p.get_project_info()
    info.company = 'ControlsBench'
    info.title = 'ControlsBench FBS Probe'
    info.version = (0, 0, 0, 1)
    info.default_namespace = 'CBPROBE'
    for name, kind, text in SOURCES:
        p.create_dut(name=name, type=kind).textual_declaration.replace(text)
    p.create_gvl(name='GVL_Probe').textual_declaration.replace(GVL_TEXT)
    fb = p.create_pou(name='FB_Probe', type=PouType.FunctionBlock)
    fb.textual_declaration.replace(FB_DECL)
    fb.textual_implementation.replace(FB_IMPL)
    fn = p.create_pou(name='F_Probe', type=PouType.Function, return_type='DINT')
    fn.textual_declaration.replace(FN_DECL)
    fn.textual_implementation.replace(FN_IMPL)
    p.save()
    p.check_all_pool_objects()
    report['binaryCompile'] = messages()
    report['projectMethods'] = {k: hasattr(p, k) for k in ['validate_for_fbs', 'convert_to_fbs', 'save_as_compiled_library']}
    p.close()

    copy = os.path.join(OUT, 'FbsProbe-copy.library')
    shutil.copyfile(original, copy)
    container = os.path.join(OUT, 'fbs')
    os.makedirs(container)
    # The first probe showed a bare directory is rejected; record each tried form.
    attempts = [os.path.join(container, 'FbsProbe.fbslib'), os.path.join(container, 'FbsProbe.fbsproj')]
    report['convertAttempts'] = []
    root = None
    for dest in attempts:
        if projects.primary is None:
            c = projects.open(copy)
        else:
            c = projects.primary
        if 'validation' not in report:
            validation = c.validate_for_fbs() or []
            report['validation'] = [{'status': str(v.status), 'message': str(v.message),
                                     'object': str(v.affected_object.get_name()) if v.affected_object is not None else None}
                                    for v in validation]
        try:
            ok = bool(c.convert_to_fbs(dest, Handler()))
            report['convertAttempts'].append({'destination': os.path.basename(dest), 'returned': ok})
            if ok:
                root = dest
                break
        except Exception as e:
            report['convertAttempts'].append({'destination': os.path.basename(dest), 'error': str(e)})
    report['primaryAfterConvert'] = str(projects.primary.path) if projects.primary is not None else None
    if projects.primary is not None:
        projects.primary.close()
    report['convertedTree'] = tree(container)
    if root is None:
        raise Exception('No conversion destination form was accepted')
    reopened = fbs.open(root)
    report['reopenedPath'] = str(reopened.path)
    readback = {}
    for name in ['ST_ProbeStruct', 'U_ProbeUnion', 'GVL_Probe', 'FB_Probe', 'F_Probe']:
        found = reopened.find(name, True)
        entry = {'found': len(found)}
        if len(found) == 1:
            obj = found[0]
            entry['declaration'] = obj.textual_declaration.text if obj.has_textual_declaration else None
            entry['implementation'] = obj.textual_implementation.text if obj.has_textual_implementation else None
        readback[name] = entry
    report['readback'] = readback
    rinfo = reopened.get_project_info()
    report['reopenedInfo'] = {'title': str(rinfo.title), 'company': str(rinfo.company),
                              'version': str(rinfo.version), 'namespace': str(rinfo.default_namespace)}
    for category in system.get_message_categories():
        system.clear_messages(category)
    reopened.check_all_pool_objects()
    report['fbsCompile'] = messages()
    compiled = os.path.join(OUT, 'FbsProbe-from-fbs.compiled-library')
    reopened.save_as_compiled_library(compiled)
    report['compiledFromFbs'] = os.path.getsize(compiled)
    reopened.close()
    report['treeAfterReopen'] = tree(root)
    report['status'] = 'pass'
except Exception:
    report['error'] = traceback.format_exc()
finally:
    if projects.primary is not None:
        projects.primary.close()
    with open(os.path.join(OUT, 'result.json'), 'wb') as f:
        f.write((json.dumps(report, indent=2, sort_keys=True) + '\n').encode('utf-8'))
    with open(os.path.join(ROOT, 'artifacts', 'latest-probe-fbs.json'), 'wb') as f:
        f.write((json.dumps({'directory': OUT, 'status': report['status']}) + '\n').encode('utf-8'))
    print('FBS probe finished: ' + report['status'])
