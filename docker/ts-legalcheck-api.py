"""
Bridge endpoint for ts-app compatibility.
Adds /check-module and /reload routes to the ts_legalcheck Flask app.
"""
import json
import logging
import os
import threading
from pathlib import Path

from flask import request, jsonify
from ts_legalcheck.ui.app import app
from ts_legalcheck.engine import loadDefinitions, createEngineWithDefinitions
from ts_legalcheck.engine.context import Module

logger = logging.getLogger('ts_legalcheck.api')

MODELS_DIR = Path(os.environ.get('TS_LEGALCHECK_MODELS_PATH', 'data'))
DEFAULT_MODEL = os.environ.get('TS_LEGALCHECK_DEFAULT_MODEL', 'LicenseConstraints_v4.5.toml')

_engine = None
# The Z3-backed engine is not thread-safe, and Flask serves requests on parallel
# threads: concurrent checks on the shared engine crash the solver (and the whole
# process with it). Every use of the engine holds this lock.
_engine_lock = threading.Lock()

def get_engine():
    global _engine
    if _engine is None:
        _engine = _load_engine()
    return _engine

def _load_engine():
    model_path = MODELS_DIR / DEFAULT_MODEL
    defs = loadDefinitions(model_path)
    return createEngineWithDefinitions(defs)


@app.route('/check-module', methods=['POST'])
def check_module():
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({'error': 'Invalid JSON body'}), 400

    try:
        mod = Module.load(json.dumps(body))
    except Exception as e:
        logger.error(f'Failed to parse module: {e}')
        return jsonify({'error': f'Failed to parse module: {str(e)}'}), 400

    if mod is None:
        return jsonify({'error': 'Could not load module from request body'}), 400

    try:
        with _engine_lock:
            engine = get_engine()
            result = engine.checkModule(mod, extended_results=False)
        # Wrap result in module key to match ts-app expected format:
        # { moduleName: { componentKey: { licenseKey: result } } }
        wrapped = {body['key']: result}
        return jsonify(wrapped)
    except Exception as e:
        logger.error(f'Check module failed: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/reload', methods=['POST'])
def reload():
    global _engine
    try:
        with _engine_lock:
            _engine = _load_engine()
        return jsonify({'status': 'ok'})
    except Exception as e:
        logger.error(f'Reload failed: {e}')
        return jsonify({'error': str(e)}), 400


if __name__ == '__main__':
    port = int(os.environ.get('TS_LEGALCHECK_WEBUI_PORT', 5000))
    # The Werkzeug debugger executes code for anyone who reaches the port: opt-in only.
    debug = os.environ.get('TS_LEGALCHECK_DEBUG', 'false').lower() == 'true'
    app.run(debug=debug, host='0.0.0.0', port=port)
