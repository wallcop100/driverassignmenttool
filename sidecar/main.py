"""Flask sidecar. Binds a free port, prints "PORT <n>" to stdout for Electron."""
import socket
import sys

from flask import Flask, jsonify, request

import export_csv
import parsing
import validation

app = Flask(__name__)

# ponytail: single-window desktop app — the parsed model lives in a module
# global instead of round-tripping with every request.
STATE = None


@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/parse")
def parse():
    global STATE
    form = request.files.get("form")
    links = request.files.get("links")
    if not form or not links:
        return jsonify({"error": "both files are required: form, links"}), 400
    try:
        model, STATE = parsing.build_model(
            form.read().decode("utf-8-sig"), links.read().decode("utf-8-sig"))
    except parsing.ParseError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(model)


def _require_state():
    if STATE is None:
        return jsonify({"error": "no files loaded — POST /parse first"}), 409
    return None


@app.post("/validate")
def validate():
    err = _require_state()
    if err:
        return err
    body = request.get_json(force=True)
    flags = validation.validate(STATE, body.get("assignments") or {}, body.get("addedDrivers"))
    return jsonify({"flags": flags})


@app.post("/suggest")
def suggest():
    err = _require_state()
    if err:
        return err
    body = request.get_json(force=True)
    targets = validation.suggest(STATE, body.get("linkRef"),
                                 body.get("assignments") or {}, body.get("addedDrivers"))
    return jsonify({"targets": targets})


@app.post("/eligibility")
def eligibility():
    err = _require_state()
    if err:
        return err
    body = request.get_json(force=True)
    result = validation.eligibility(STATE, body.get("zone"),
                                    body.get("assignments") or {}, body.get("addedDrivers"))
    return jsonify(result)


@app.post("/export")
def export():
    err = _require_state()
    if err:
        return err
    body = request.get_json(force=True)
    csv_text = export_csv.export_csv(STATE, body.get("assignments") or {}, body.get("addedDrivers"))
    return csv_text, 200, {"Content-Type": "text/csv; charset=utf-8"}


if __name__ == "__main__":
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    print(f"PORT {port}", flush=True)
    app.run(host="127.0.0.1", port=port)
