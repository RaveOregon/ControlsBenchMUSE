from __future__ import print_function
import os, json, traceback
from scriptengine import *

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'artifacts', 'probe')
if not os.path.isdir(out): os.makedirs(out)
report = {'status': 'failed', 'plcContacted': False}
try:
    if projects.primary is not None: raise Exception('Probe requires its own empty headless IDE process')
    p = projects.create(os.path.join(out, 'Probe.library'))
    info = p.get_project_info()
    report['infoProperties'] = sorted([str(x) for x in dir(info) if not str(x).startswith('_')])
    report['projectProperties'] = sorted([str(x) for x in dir(p) if not str(x).startswith('_')])
    report['fbsAvailable'] = 'fbs' in globals()
    report['convertAvailable'] = hasattr(p, 'convert_to_fbs')
    report['libraryManager'] = sorted([str(x) for x in dir(librarymanager) if not str(x).startswith('_')])
    info.company = 'ControlsBench'
    info.title = 'ControlsBench Probe'
    info.version = (0, 1, 0, 0)
    report['infoAfter'] = str(info)
    p.save()
    p.check_all_pool_objects()
    report['messages'] = [str(x) for c in system.get_message_categories() for x in system.get_messages(c)]
    p.save_as_compiled_library(os.path.join(out, 'Probe.compiled-library'))
    report['status'] = 'pass'
except Exception:
    report['error'] = traceback.format_exc()
finally:
    with open(os.path.join(out, 'result.json'), 'w') as f: json.dump(report, f, indent=2)
    if projects.primary is not None: projects.primary.close()
