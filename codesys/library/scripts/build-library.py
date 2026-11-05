from __future__ import print_function
# Offline ControlsBench library build. Run only through build-library.ps1, which
# starts a dedicated hidden --noUI CODESYS process and passes Git provenance.
# Never logs in to a controller, never opens another user's project.
import os, json, traceback, hashlib, datetime, shutil, re
from scriptengine import *

system.trace = False
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
STARTED = datetime.datetime.utcnow()
STAMP = STARTED.strftime('%Y-%m-%dT%H-%M-%S-%fZ')
OUT = os.path.join(ROOT, 'artifacts', STAMP)
os.makedirs(OUT)
LOG = os.path.join(OUT, 'build.log')
CACHE_DIRS = ['.sidecars', '.auxiliaries']
result = {'schema': 'controlsbench.library-build/2', 'status': 'failed', 'plcContacted': False,
          'deployed': False, 'runtimeChecks': 'compiled only; conformance harness not executed',
          'startedUtc': STARTED.isoformat() + 'Z', 'steps': [], 'sources': {}, 'artifacts': {},
          'readback': {}, 'fbs': {}, 'consumers': {}}


def log(message):
    with open(LOG, 'a') as f:
        f.write(str(message) + '\n')
    print(message)


def load_json(path):
    with open(path, 'rb') as f:
        return json.loads(f.read().decode('utf-8'))


def write_json(path, value):
    with open(path, 'wb') as f:
        f.write((json.dumps(value, indent=2, sort_keys=True, separators=(',', ': ')) + '\n').encode('utf-8'))


def digest(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def read_text(path):
    with open(path, 'rb') as f:
        return f.read().decode('utf-8').replace('\r\n', '\n')


def rel(path):
    return os.path.relpath(path, REPO).replace('\\', '/')


def kind_of(text):
    head = text.lstrip()
    if head.startswith('TYPE '):
        return 'union' if re.search(r'^\s*UNION\s*$', text, re.M) else 'struct'
    if head.startswith('{attribute') or head.startswith('VAR_GLOBAL'):
        return 'gvl'
    if head.startswith('FUNCTION_BLOCK '):
        return 'fb'
    if head.startswith('FUNCTION '):
        return 'function'
    if head.startswith('PROGRAM '):
        return 'program'
    raise Exception('Unknown object kind')


TERMINATOR = {'fb': 'END_FUNCTION_BLOCK', 'function': 'END_FUNCTION', 'program': 'END_PROGRAM'}


def split(text, kind):
    if kind in ('struct', 'union', 'gvl'):
        return text.strip(), None
    end = text.rfind('END_VAR')
    if end < 0:
        raise Exception('No declaration boundary')
    end += len('END_VAR')
    body = text[end:].strip()
    if not body.endswith(TERMINATOR[kind]):
        raise Exception('Missing ' + TERMINATOR[kind])
    return text[:end].strip(), body[:-len(TERMINATOR[kind])].strip()


def add_object(parent, name, path):
    text = read_text(path)
    kind = kind_of(text)
    decl, impl = split(text, kind)
    if kind == 'struct':
        obj = parent.create_dut(name=name, type=DutType.Structure)
    elif kind == 'union':
        obj = parent.create_dut(name=name, type=DutType.Union)
    elif kind == 'gvl':
        obj = parent.create_gvl(name)
    elif kind == 'fb':
        obj = parent.create_pou(name=name, type=PouType.FunctionBlock)
    elif kind == 'function':
        obj = parent.create_pou(name=name, type=PouType.Function, return_type='BOOL')
    else:
        found = parent.find(name, False)
        obj = found[0] if len(found) == 1 else parent.create_pou(name=name, type=PouType.Program)
    obj.textual_declaration.replace(decl)
    if impl is not None:
        obj.textual_implementation.replace(impl)
    return kind


def verify_object(parent, name, path, recursive):
    text = read_text(path)
    kind = kind_of(text)
    decl, impl = split(text, kind)
    found = parent.find(name, recursive)
    if len(found) != 1:
        raise Exception('Saved source missing or ambiguous: ' + name)
    obj = found[0]
    if obj.textual_declaration.text.replace('\r\n', '\n').strip() != decl:
        raise Exception('Saved declaration differs: ' + name)
    if impl is not None and obj.textual_implementation.text.replace('\r\n', '\n').strip() != impl:
        raise Exception('Saved implementation differs: ' + name)


def clear_messages():
    for category in system.get_message_categories():
        system.clear_messages(category)


def checkpoint(label, require_summary):
    records = []
    errors = []
    tool_warnings = []
    compile_errors = 0
    compile_warnings = 0
    summaries = 0
    for category in system.get_message_categories():
        for m in system.get_message_objects(category):
            severity = str(m.severity)
            text = str(m.text) if hasattr(m, 'text') else str(m)
            records.append(severity + ': ' + text)
            if severity.lower() in ('error', 'fatalerror'):
                errors.append(text)
            elif severity.lower() == 'warning':
                tool_warnings.append(text)
            s = re.search(r'Compile complete -- (\d+) errors?, (\d+) warnings?', text)
            if s:
                summaries += 1
                compile_errors += int(s.group(1))
                compile_warnings += int(s.group(2))
            s = re.search(r'Additional code checks complete -- (\d+) errors?', text)
            if s:
                compile_errors += int(s.group(1))
    step = {'step': label, 'messages': records, 'errors': errors, 'compilerErrors': compile_errors,
            'compilerWarnings': compile_warnings, 'compileSummaries': summaries, 'toolWarnings': tool_warnings}
    result['steps'].append(step)
    log('%s: %d errors, %d compiler warnings, %d summaries' % (label, len(errors) + compile_errors, compile_warnings, summaries))
    if errors or compile_errors:
        raise Exception(label + ' failed:\n' + '\n'.join(errors))
    if compile_warnings:
        raise Exception(label + ' produced compiler warnings')
    if require_summary and summaries == 0:
        raise Exception(label + ' produced no compiler summary')
    clear_messages()


def set_info(project, title, version, namespace, placeholder, description):
    info = project.get_project_info()
    info.company = 'ControlsBench'
    info.title = title
    info.version = tuple(int(x) for x in version.split('.'))
    info.default_namespace = namespace
    info.values['Placeholder'] = placeholder
    info.description = description


def tree_hashes(path):
    hashes = {}
    for base, dirs, names in os.walk(path):
        dirs[:] = [d for d in dirs if d not in CACHE_DIRS]
        for n in names:
            full = os.path.join(base, n)
            hashes[os.path.relpath(full, path).replace('\\', '/')] = digest(full)
    return hashes


def copy_clean(src, dst):
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(*CACHE_DIRS))


class ConversionHandler(NativeImportHandler):
    def __init__(self, events):
        self.events = events

    def conflict(self, name, existingObject, newguid):
        self.events.append({'conflict': str(name)})
        return NativeImportResolve.cancel

    def progress(self, name, pastedObject, exception):
        if exception is not None:
            self.events.append({'object': str(name), 'exception': str(exception)})

    def skipped(self, name):
        self.events.append({'skipped': str(name)})


def map_objects(map_id):
    manifest = load_json(os.path.join(ROOT, 'mappings', 'generated', map_id + '.manifest.json'))
    return [(n, os.path.join(ROOT, 'examples', 'mappings', map_id, n + '.st')) for n in manifest['plcObjects']]


def consumer_objects(section):
    objects = []
    for map_id in section['mappings']:
        objects.extend(map_objects(map_id))
    for path in section['objects']:
        full = os.path.join(ROOT, path)
        objects.append((os.path.splitext(os.path.basename(full))[0], full))
    return objects


def record_sources(group, objects):
    result['sources'][group] = dict((rel(p), digest(p)) for n, p in objects)


def build_consumers(tag, manifest, library_id):
    out = os.path.join(OUT, 'consumers-' + tag)
    os.makedirs(out)
    section = manifest['consumerLibrary']
    objects = consumer_objects(section)
    lib_path = os.path.join(out, 'ControlsBenchConsumer.library')
    consumer = projects.create(lib_path)
    set_info(consumer, section['title'], section['version'], section['namespace'], section['placeholder'], section['description'])
    consumer.get_library_manager().add_library(library_id)
    for name, path in objects:
        add_object(consumer, name, path)
    consumer.save()
    clear_messages()
    consumer.check_all_pool_objects()
    checkpoint(tag + ':consumer-library-pool-check', True)
    compiled = os.path.join(out, 'ControlsBenchConsumer.compiled-library')
    consumer.save_as_compiled_library(compiled)
    checkpoint(tag + ':consumer-library-compiled', False)
    consumer.close()
    reopened = projects.open(lib_path)
    for name, path in objects:
        verify_object(reopened, name, path, True)
    reopened.close()

    app_section = manifest['consumerApplication']
    app_objects = consumer_objects(app_section)
    template = os.path.join(REPO, app_section['template'])
    app_path = os.path.join(out, 'ControlsBenchConsumer.project')
    app_project = projects.open(template)
    app_project.save_as(app_path)
    info = app_project.get_project_info()
    info.title = app_section['title']
    app = app_project.active_application
    app.get_library_manager().add_library(library_id)
    for name, path in app_objects:
        add_object(app, name, path)
    program = os.path.join(ROOT, app_section['program'])
    add_object(app, 'PLC_PRG', program)
    app_project.save()
    clear_messages()
    app.build()
    checkpoint(tag + ':consumer-application-build', True)
    app_project.save()
    app_project.close()
    reopened = projects.open(app_path)
    app = reopened.active_application
    for name, path in app_objects + [('PLC_PRG', program)]:
        verify_object(app, name, path, False)
    reopened.close()
    artifacts = {}
    for name in ['ControlsBenchConsumer.library', 'ControlsBenchConsumer.compiled-library', 'ControlsBenchConsumer.project']:
        artifacts['consumers-' + tag + '/' + name] = digest(os.path.join(out, name))
    result['artifacts'].update(artifacts)
    result['consumers'][tag] = {'library': library_id, 'objects': [n for n, p in objects],
                                'applicationObjects': [n for n, p in app_objects] + ['PLC_PRG'],
                                'readback': 'consumer library and application sources reopened and matched'}


try:
    if projects.primary is not None:
        raise Exception('Requires a separate empty headless CODESYS process')
    request_path = os.environ.get('CB_BUILD_REQUEST')
    if not request_path or not os.path.isfile(request_path):
        raise Exception('Missing build request; run scripts/build-library.ps1')
    request = load_json(request_path)
    manifest_path = os.path.join(ROOT, 'library.json')
    manifest = load_json(manifest_path)
    package = manifest['package']
    result['label'] = package['label']
    result['library'] = {'title': package['title'], 'company': package['company'],
                         'version': package['version'], 'namespace': package['namespace']}
    result['versions'] = manifest['versions']
    result['provenance'] = {'request': request, 'manifestSha256': digest(manifest_path),
                            'builderSha256': digest(os.path.abspath(__file__)),
                            'executable': str(getattr(system, 'executable_filename', ''))}
    if os.path.exists(os.path.join(ROOT, 'builds', package['label'])):
        raise Exception('builds/' + package['label'] + ' is promoted and immutable; bump the version first')
    library_id = '%s, %s (%s)' % (package['title'], package['version'], package['company'])
    original = os.path.join(REPO, manifest['consumerApplication']['template'])
    result['frozenDemoBefore'] = digest(original)

    # 1. Core library from Git's text sources.
    core = [(n, os.path.join(ROOT, 'source', n + '.st')) for n in manifest['core']]
    record_sources('core', core)
    record_sources('consumer', consumer_objects(manifest['consumerLibrary']))
    app_sources = consumer_objects(manifest['consumerApplication']) + [('PLC_PRG', os.path.join(ROOT, manifest['consumerApplication']['program']))]
    record_sources('application', app_sources)
    libpath = os.path.join(OUT, 'ControlsBenchCore.library')
    p = projects.create(libpath)
    set_info(p, package['title'], package['version'], package['namespace'], package['placeholder'], package['description'])
    for name, path in core:
        add_object(p, name, path)
    p.save()
    clear_messages()
    p.check_all_pool_objects()
    checkpoint('core-pool-check', True)
    compiled = os.path.join(OUT, 'ControlsBenchCore.compiled-library')
    p.save_as_compiled_library(compiled)
    checkpoint('core-compiled-library', False)
    p.close()
    saved = projects.open(libpath)
    for name, path in core:
        verify_object(saved, name, path, True)
    saved.close()
    result['readback']['core'] = 'all %d core declarations and implementations match source/' % len(core)
    result['artifacts']['ControlsBenchCore.library'] = digest(libpath)
    result['artifacts']['ControlsBenchCore.compiled-library'] = digest(compiled)

    # 2. File-Based Storage pilot on a COPY of the core library.
    fbs_info = result['fbs']
    fbs_info['available'] = ('fbs' in globals()) and ('NativeImportHandler' in globals())
    fbs_info['plugin'] = request.get('fbsPlugin')
    if not fbs_info['available']:
        raise Exception('File-Based Storage scripting API is not available in this profile')
    copy = os.path.join(OUT, 'fbs-source-copy.library')
    shutil.copyfile(libpath, copy)
    c = projects.open(copy)
    fbs_info['validation'] = [{'status': str(v.status), 'message': str(v.message),
                               'object': str(v.affected_object.get_name()) if v.affected_object is not None else None}
                              for v in (c.validate_for_fbs() or [])]
    if any(v['status'].lower().endswith('error') for v in fbs_info['validation']):
        raise Exception('FBS validation reported errors')
    events = []
    fbs_root = os.path.join(OUT, 'fbs', 'ControlsBenchCore.fbslib')
    os.makedirs(os.path.dirname(fbs_root))
    fbs_info['converted'] = bool(c.convert_to_fbs(fbs_root, ConversionHandler(events)))
    fbs_info['conversionEvents'] = events
    if projects.primary is not None:
        projects.primary.close()
    if not fbs_info['converted'] or events:
        raise Exception('FBS conversion did not complete cleanly')
    pristine = os.path.join(OUT, 'fbs-pristine', 'ControlsBenchCore.fbslib')
    copy_clean(fbs_root, pristine)
    fbs_info['files'] = tree_hashes(pristine)
    native = fbs.open(fbs_root)
    for name, path in core:
        verify_object(native, name, path, True)
    info = native.get_project_info()
    fbs_info['projectInfo'] = {'title': str(info.title), 'company': str(info.company),
                               'version': str(info.version), 'namespace': str(info.default_namespace)}
    clear_messages()
    native.check_all_pool_objects()
    checkpoint('fbs-core-pool-check', True)
    fbs_compiled = os.path.join(OUT, 'ControlsBenchCore.fbs.compiled-library')
    native.save_as_compiled_library(fbs_compiled)
    checkpoint('fbs-core-compiled-library', False)
    native.close()
    result['artifacts']['ControlsBenchCore.fbs.compiled-library'] = digest(fbs_compiled)
    # The Git subset (without .sidecars/.auxiliaries caches) must reopen and compile on its own.
    clean = os.path.join(OUT, 'fbs-clean-test', 'ControlsBenchCore.fbslib')
    copy_clean(pristine, clean)
    reopened = fbs.open(clean)
    for name, path in core:
        verify_object(reopened, name, path, True)
    clear_messages()
    reopened.check_all_pool_objects()
    checkpoint('fbs-clean-subset-pool-check', True)
    reopened.close()
    after = tree_hashes(clean)
    fbs_info['cleanSubsetChangedOnReopen'] = sorted(k for k in fbs_info['files'] if after.get(k) != fbs_info['files'][k])
    fbs_info['cleanSubsetAddedOnReopen'] = sorted(k for k in after if k not in fbs_info['files'])
    result['readback']['fbs'] = 'converted copy and its cache-free Git subset reopened with fbs.open; all core objects match source/'

    # 3. Independent Library Manager consumers: binary-built library, then FBS-built library.
    repo_path = os.path.join(ROOT, 'repository')
    if not os.path.isdir(repo_path):
        os.makedirs(repo_path)
    repo_name = 'ControlsBench Offline Development ' + hashlib.sha256(repo_path.encode('utf-8')).hexdigest()[:8]
    existing = [r for r in librarymanager.repositories
                if os.path.normcase(str(r.root_folder)) == os.path.normcase(repo_path) and str(r.name).startswith('ControlsBench Offline Development')]
    repository = existing[0] if existing else librarymanager.insert_repository(repo_path, repo_name, 0)
    result['libraryRepository'] = rel(repo_path)
    result['installedLibrary'] = library_id
    librarymanager.install_library(compiled, repository=repository, overwrite=True)
    build_consumers('binary', manifest, library_id)
    librarymanager.install_library(fbs_compiled, repository=repository, overwrite=True)
    build_consumers('fbs', manifest, library_id)
    result['installedFrom'] = 'ControlsBenchCore.fbs.compiled-library'

    result['frozenDemoAfter'] = digest(original)
    if result['frozenDemoAfter'] != result['frozenDemoBefore']:
        raise Exception('Frozen consumer template changed')
    result['status'] = 'pass'
except Exception:
    result['error'] = traceback.format_exc()
    log(result['error'])
finally:
    if projects.primary is not None:
        projects.primary.close()
    result['finishedUtc'] = datetime.datetime.utcnow().isoformat() + 'Z'
    write_json(os.path.join(OUT, 'result.json'), result)
    write_json(os.path.join(ROOT, 'artifacts', 'latest.json'), {'directory': OUT, 'status': result['status']})
    log('Finished: ' + result['status'])
