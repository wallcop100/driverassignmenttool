"""Parse the two DataJoin CSVs into the model the renderer works with."""
import csv
import io
import re

DRIVER_RE = re.compile(r"(?P<Watts>\d+(\.\d+)?)W(\s\|\s(?P<Value>\d+(\.\d+)?)(?P<Unit>[AV]))?")
# Node Restrictions carry an optional per-node watt cap and/or an fV cap,
# e.g. "25W | 55fV", "55fV", "25W", or empty. Order not assumed.
NODE_FV_RE = re.compile(r"(?P<FV>\d+(\.\d+)?)fV")
NODE_W_RE = re.compile(r"(?P<W>\d+(\.\d+)?)W")

FORM_COLUMNS = [
    "Pullzone", "ParentElementRef", "ElementRef", "ElementTypeRef",
    "Driver Restrictions", "Node Restrictions", "CurrentNodePowerInfo",
    "Node", "ToEntityType", "ToEntityRefs", "ControlGroup",
]
LINK_COLUMNS = [
    "PullZone", "ControlGroupText", "LinkRef", "LinkTypeRef",
    "LinkSumPower(W)", "LinkCurrent", "LinkVoltage(V)", "LinkForwardVoltage(Vf)",
    "ToLocationName", "SecondaryPowerType",
]


class ParseError(ValueError):
    pass


def _read_rows(text, required, label):
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ParseError(f"{label}: file is empty or has no data rows")
    missing = [c for c in required if c not in rows[0]]
    if missing:
        raise ParseError(f"{label}: missing column(s): {', '.join(missing)}")
    return rows


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_driver_restrictions(raw):
    """-> (powerType, maxPowerW, currentA, outputVoltageV); all None if unparseable."""
    m = DRIVER_RE.search(raw or "")
    if not m:
        return None, None, None, None
    watts = float(m.group("Watts"))
    unit, value = m.group("Unit"), m.group("Value")
    if unit == "A":
        return "CC", watts, float(value), None
    if unit == "V":
        return "CV", watts, None, float(value)
    return None, watts, None, None  # wattage-only


def parse_node_restrictions(raw):
    """-> (maxLoadW, maxFvV); each None if not declared."""
    raw = raw or ""
    w = NODE_W_RE.search(raw)
    fv = NODE_FV_RE.search(raw)
    return (float(w.group("W")) if w else None,
            float(fv.group("FV")) if fv else None)


def parse_form(text):
    """-> (drivers list, baseline dict, original rows, fieldnames)."""
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise ParseError("Driver Assignment CSV: file is empty or has no data rows")
    missing = [c for c in FORM_COLUMNS if c not in rows[0]]
    if missing:
        raise ParseError(f"Driver Assignment CSV: missing column(s): {', '.join(missing)}")

    drivers, baseline = {}, {}
    for i, row in enumerate(rows, start=2):
        ref, node = (row["ElementRef"] or "").strip(), (row["Node"] or "").strip()
        if not ref:
            raise ParseError(f"Driver Assignment CSV: row {i} has no ElementRef")
        key = f"{ref}|{node}"
        if key in baseline:
            raise ParseError(f"Driver Assignment CSV: duplicate ElementRef+Node row: {key}")

        if ref not in drivers:
            power_type, max_w, current_a, out_v = parse_driver_restrictions(row["Driver Restrictions"])
            drivers[ref] = {
                "ref": ref,
                "typeRef": row["ElementTypeRef"],
                "parentRef": row["ParentElementRef"],
                "zone": row["Pullzone"],
                "powerType": power_type,
                "maxPowerW": max_w,
                "currentA": current_a,
                "outputVoltageV": out_v,
                "undetermined": max_w is None,
                "driverRestrictions": row["Driver Restrictions"],
                "nodeRestrictions": row["Node Restrictions"],
                "nodes": [],
            }
        max_load_w, max_fv_v = parse_node_restrictions(row["Node Restrictions"])
        drivers[ref]["nodes"].append({"name": node, "maxFvV": max_fv_v, "maxLoadW": max_load_w})

        refs = [r.strip() for r in (row["ToEntityRefs"] or "").split(",") if r.strip()]
        baseline[key] = {
            "toEntityType": (row["ToEntityType"] or "").strip(),
            "refs": refs,
            "controlGroup": (row["ControlGroup"] or "").strip(),
        }
    return list(drivers.values()), baseline, rows, reader.fieldnames


def parse_links(text):
    rows = _read_rows(text, LINK_COLUMNS, "Links Assignment CSV")
    links = []
    seen = set()
    for i, row in enumerate(rows, start=2):
        ref = (row["LinkRef"] or "").strip()
        if not ref:
            raise ParseError(f"Links Assignment CSV: row {i} has no LinkRef")
        if ref in seen:
            raise ParseError(f"Links Assignment CSV: duplicate LinkRef: {ref}")
        seen.add(ref)
        power_type = (row["SecondaryPowerType"] or "").strip()
        links.append({
            "ref": ref,
            "zone": row["PullZone"],
            "typeRef": row["LinkTypeRef"],
            "loadW": _num(row["LinkSumPower(W)"]),
            "currentA": _num(row["LinkCurrent"]),
            "voltageV": _num(row["LinkVoltage(V)"]),
            "fvV": _num(row["LinkForwardVoltage(Vf)"]),
            "powerType": power_type if power_type in ("CC", "CV") else None,
            "controlGroup": (row["ControlGroupText"] or "").strip(),
            "location": row["ToLocationName"],
            "positionType": (row.get("PositionType") or "").strip(),
            "threadCount": (row.get("ThreadCount") or "").strip(),
            "controlType": (row.get("ControlType") or "").strip(),
        })
    return links


def build_inventory(drivers):
    """typeRef -> template for '+ Driver', taken from the instance with the most nodes."""
    inventory = {}
    for d in drivers:
        cur = inventory.get(d["typeRef"])
        if cur is None or len(d["nodes"]) > len(cur["nodes"]):
            inventory[d["typeRef"]] = {
                "typeRef": d["typeRef"],
                "powerType": d["powerType"],
                "maxPowerW": d["maxPowerW"],
                "currentA": d["currentA"],
                "outputVoltageV": d["outputVoltageV"],
                "undetermined": d["undetermined"],
                "driverRestrictions": d["driverRestrictions"],
                "nodeRestrictions": d["nodeRestrictions"],
                "nodes": d["nodes"],
            }
    return inventory


def build_model(form_text, links_text):
    drivers, baseline, original_rows, fieldnames = parse_form(form_text)
    links = parse_links(links_text)
    zones = sorted({d["zone"] for d in drivers} | {l["zone"] for l in links})
    inventory = build_inventory(drivers)
    model = {
        "zones": zones,
        "drivers": drivers,
        "links": links,
        "inventory": sorted(inventory.values(), key=lambda t: t["typeRef"]),
        "baseline": baseline,
    }
    state = {
        "model": model,
        "drivers_by_ref": {d["ref"]: d for d in drivers},
        "links_by_ref": {l["ref"]: l for l in links},
        "inventory_by_type": inventory,
        "original_rows": original_rows,
        "fieldnames": fieldnames,
    }
    return model, state
