from __future__ import print_function
import os, json, traceback, hashlib, datetime
from scriptengine import *

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
STAMP = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S-%fZ')
OUT = os.path.join(ROOT, 'artifacts', STAMP)
os.makedirs(OUT)
result = {'status': 'failed', 'plcContacted': False, 'deployed': False,
          'libraryVersion': '0.1.0.0', 'namespace': 'CB', 'sources': {}, 'steps': []}
logfile = os.path.join(OUT, 'build.log')

def log(message):
    with open(logfile, 'a') as f: f.write(str(message) + '\n')
    print(message)

def digest(path):
    with open(path, 'rb') as f: return hashlib.sha256(f.read()).hexdigest()


def write_json(path, value):
    with open(path, 'wb') as f:
        f.write((json.dumps(value, indent=2, separators=(',', ': ')) + '\n').encode('utf-8'))

def messages():
    records = []
    errors = []
    for category in system.get_message_categories():
        for m in system.get_message_objects(category):
            text = str(m)
            records.append(text)
            if str(m.severity).lower() in ['error', 'fatalerror']: errors.append(text)
    return records, errors

def checkpoint(label):
    records, errors = messages()
    result['steps'].append({'step': label, 'messages': records, 'errors': errors})
    log(label + ': ' + str(len(errors)) + ' compiler errors')
    if errors: raise Exception('\n'.join(errors))

def add_st(parent, path):
    with open(path, 'r') as f: text = f.read().replace('\r\n', '\n')
    name = os.path.splitext(os.path.basename(path))[0]
    if text.startswith('TYPE '):
        obj = parent.create_dut(name=name, type=DutType.Structure)
        obj.textual_declaration.replace(text)
    else:
        end = text.rfind('END_VAR') + len('END_VAR')
        if end < len('END_VAR'): raise Exception('No declaration boundary in ' + path)
        kind = PouType.Program if text.startswith('PROGRAM ') else PouType.FunctionBlock
        obj = parent.create_pou(name=name, type=kind)
        obj.textual_declaration.replace(text[:end])
        terminator = 'END_PROGRAM' if kind == PouType.Program else 'END_FUNCTION_BLOCK'
        body = text[end:].strip()
        if not body.endswith(terminator): raise Exception('Missing ' + terminator)
        obj.textual_implementation.replace(body[:-len(terminator)].strip())
    return obj


def verify_st(parent, path):
    with open(path, 'r') as f: text = f.read().replace('\r\n', '\n')
    name = os.path.splitext(os.path.basename(path))[0]
    found = parent.find(name, False)
    if len(found) != 1: raise Exception('Saved source missing or ambiguous: ' + name)
    obj = found[0]
    if text.startswith('TYPE '):
        declaration = text.strip()
        implementation = None
    else:
        end = text.rfind('END_VAR') + len('END_VAR')
        declaration = text[:end].strip()
        terminator = 'END_PROGRAM' if text.startswith('PROGRAM ') else 'END_FUNCTION_BLOCK'
        implementation = text[end:].strip()[:-len(terminator)].strip()
    if obj.textual_declaration.text.replace('\r\n', '\n').strip() != declaration:
        raise Exception('Saved declaration differs: ' + name)
    if implementation is not None and obj.textual_implementation.text.replace('\r\n', '\n').strip() != implementation:
        raise Exception('Saved implementation differs: ' + name)

def project_info(project, title):
    info = project.get_project_info()
    info.company = 'ControlsBench'
    info.title = title
    info.version = (0, 1, 0, 0)
    info.default_namespace = 'CB'
    info.values['Placeholder'] = 'ControlsBenchCore' if title == 'ControlsBench Core' else 'ControlsBenchConsumer'
    info.description = 'Prototype raw I/O interceptor library; offline development build, not deployed'
    return info

try:
    # This script is for an independent noUI process, not the active editing IDE.
    if projects.primary is not None: raise Exception('Requires a separate empty headless CODESYS process')
    original = os.path.join(REPO, 'codesys', 'conveyordemo.project')
    original_hash = digest(original)
    result['frozenDemoBefore'] = original_hash
    libpath = os.path.join(OUT, 'ControlsBenchCore.library')
    p = projects.create(libpath)
    result['compiler'] = 'New library default under CODESYS 3.5.22.30; consumer application inherits M8 compiler settings'
    project_info(p, 'ControlsBench Core')
    ordered = ['ST_CB_Config', 'ST_CB_Numeric', 'ST_CB_Image', 'ST_CB_Slot', 'ST_CB_Request', 'ST_CB_Status',
               'FB_CB_DI', 'FB_CB_AI', 'FB_CB_DO', 'FB_CB_AO', 'FB_CB_Session', 'FB_CB_OutputCapture']
    for name in ordered:
        source = os.path.join(ROOT, 'source', name + '.st')
        add_st(p, source)
        result['sources'][name] = digest(source)
    p.save()
    p.check_all_pool_objects()
    checkpoint('core-pool-check')
    compiled = os.path.join(OUT, 'ControlsBenchCore.compiled-library')
    p.save_as_compiled_library(compiled)
    checkpoint('compiled-library')
    result['artifacts'] = {os.path.basename(x): digest(x) for x in [libpath, compiled]}
    result['fbsAvailable'] = hasattr(p, 'validate_for_fbs') and hasattr(p, 'convert_to_fbs')
    # Preserve source/API readiness separately from actual FBS conversion.
    if result['fbsAvailable']:
        result['fbsValidation'] = [str(x) for x in p.validate_for_fbs()]
    p.close()
    # Read the saved source project back; compilation alone does not prove that
    # Git's text source and the distributed editable library still agree.
    saved = projects.open(libpath)
    for name in ordered:
        verify_st(saved, os.path.join(ROOT, 'source', name + '.st'))
    saved.close()
    result['sourceReadback'] = 'all public DUT/FB declarations and implementations match'

    # Own development repository: never replace a system or customer library.
    repo_path = os.path.join(ROOT, 'repository')
    if not os.path.isdir(repo_path): os.makedirs(repo_path)
    repositories = [r for r in librarymanager.repositories if os.path.normcase(str(r.root_folder)) == os.path.normcase(repo_path)
                    and str(r.name).startswith('ControlsBench Offline Development')]
    repo_name = 'ControlsBench Offline Development ' + hashlib.sha256(repo_path.encode('utf-8')).hexdigest()[:8]
    repository = repositories[0] if repositories else librarymanager.insert_repository(repo_path, repo_name, 0)
    librarymanager.install_library(compiled, repository=repository, overwrite=True)
    result['libraryRepository'] = repo_path
    result['installedLibrary'] = 'ControlsBench Core, 0.1.0.0 (ControlsBench)'
    consumer = projects.create(os.path.join(OUT, 'ControlsBenchConsumer.library'))
    project_info(consumer, 'ControlsBench Consumer Example')
    manager = consumer.get_library_manager()
    manager.add_library('ControlsBench Core, 0.1.0.0 (ControlsBench)')
    consumer_source = os.path.join(ROOT, 'examples', 'FB_CB_ConsumerChecks.st')
    result['consumerSource'] = digest(consumer_source)
    add_st(consumer, consumer_source)
    consumer.save()
    consumer.check_all_pool_objects()
    checkpoint('independent-consumer-pool-check')
    consumer.save_as_compiled_library(os.path.join(OUT, 'ControlsBenchConsumer.compiled-library'))
    checkpoint('independent-consumer-compiled')
    consumer.close()

    # Use the exact known device/task configuration in a separate offline example.
    # All original machine POUs stay as inherited, uncalled template content.
    app_project = projects.open(original)
    app_project.save_as(os.path.join(OUT, 'ControlsBenchConsumer.project'))
    app = app_project.active_application
    app.get_library_manager().add_library('ControlsBench Core, 0.1.0.0 (ControlsBench)')
    add_st(app, os.path.join(ROOT, 'examples', 'FB_CB_ConsumerChecks.st'))
    prg = app.find('PLC_PRG', False)[0]
    prg.textual_declaration.replace('PROGRAM PLC_PRG\nVAR\n    Checks : FB_CB_ConsumerChecks;\nEND_VAR')
    prg.textual_implementation.replace('Checks();')
    app_project.save()
    app.build()
    checkpoint('consumer-application-build')
    app_project.save()
    result['consumerApplication'] = digest(app_project.path)
    app_project.close()
    for name in ['ControlsBenchConsumer.library', 'ControlsBenchConsumer.compiled-library', 'ControlsBenchConsumer.project']:
        result['artifacts'][name] = digest(os.path.join(OUT, name))
    result['frozenDemoAfter'] = digest(original)
    if result['frozenDemoAfter'] != original_hash: raise Exception('Frozen original changed')
    result['status'] = 'pass'
    result['runtimeChecks'] = 'compiled only; test harness not deployed or executed'
except Exception:
    result['error'] = traceback.format_exc()
    log(result['error'])
finally:
    if projects.primary is not None: projects.primary.close()
    write_json(os.path.join(OUT, 'result.json'), result)
    write_json(os.path.join(ROOT, 'artifacts', 'latest.json'), {'directory': OUT, 'status': result['status']})
    log('Finished: ' + result['status'])
