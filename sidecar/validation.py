"""Port of DriverHealthCheck.sql — 7 of 8 checks.

Node-Exists is deferred to DataJoin (needs ElementTypes.Parameters, spec §7).
ControlGroup check is reduced to "node must not span multiple groups": the UI
derives the ControlGroup column from the assigned links on export, so there is
no independent user value to cross-check.

Levels: FAIL = overfill/blocking, MISMATCH = wrong type/voltage/current
(fail severity, distinct visual), WARN = limit undeclared or expected band.
"""

CURRENT_TOLERANCE = 0.15


def materialize_added(state, added_drivers):
    """Turn {ref, typeRef, zone} into full driver dicts using the inventory template."""
    out = []
    for a in added_drivers or []:
        template = state["inventory_by_type"].get(a["typeRef"])
        if not template:
            continue
        out.append({**template, "ref": a["ref"], "zone": a["zone"], "parentRef": "", "added": True})
    return out


def effective_drivers(state, added_drivers):
    return state["model"]["drivers"] + materialize_added(state, added_drivers)


def _node_links(state, assignments, driver, node_name):
    entry = assignments.get(f"{driver['ref']}|{node_name}") or {}
    refs = entry.get("refs") or []
    links = [state["links_by_ref"][r] for r in refs if r in state["links_by_ref"]]
    unknown = [r for r in refs if r not in state["links_by_ref"]]
    return links, unknown


def validate_driver(state, assignments, driver):
    flags = []
    ref = driver["ref"]

    def flag(level, check, message, node=None, link=None):
        flags.append({"driver": ref, "node": node, "link": link,
                      "level": level, "check": check, "message": message})

    per_node = {}
    for node in driver["nodes"]:
        links, unknown = _node_links(state, assignments, driver, node["name"])
        per_node[node["name"]] = links
        if unknown:
            flag("WARN", "EntityLoad",
                 f"no load data for {', '.join(unknown)} (not in Links CSV)", node=node["name"])

    all_links = [l for links in per_node.values() for l in links]
    if not all_links:
        return flags

    # 1. Driver Type Match
    if driver["powerType"] is None:
        flag("WARN", "TypeMatch", "driver CC/CV type undeclared — type match not verified")
    else:
        for node_name, links in per_node.items():
            for l in links:
                if l["powerType"] and l["powerType"] != driver["powerType"]:
                    flag("MISMATCH", "TypeMatch",
                         f"{l['ref']} is {l['powerType']} on a {driver['powerType']} driver",
                         node=node_name, link=l["ref"])

    # 2. CV Voltage
    if driver["powerType"] == "CV":
        if driver["outputVoltageV"] is None:
            flag("WARN", "CVVoltage", "output voltage undeclared — voltage not verified")
        else:
            for node_name, links in per_node.items():
                for l in links:
                    if not l["voltageV"]:  # 0 or blank = not recorded, not a real 0V link
                        flag("WARN", "CVVoltage",
                             f"{l['ref']} has no voltage data — voltage not verified",
                             node=node_name, link=l["ref"])
                    elif abs(l["voltageV"] - driver["outputVoltageV"]) > 1e-6:
                        flag("MISMATCH", "CVVoltage",
                             f"{l['ref']} is {l['voltageV']:g}V, driver outputs {driver['outputVoltageV']:g}V",
                             node=node_name, link=l["ref"])

    # 3. Driver Total Wattage + 4. No-Split Single Ref
    loads = [l["loadW"] for l in all_links if l["loadW"] is not None]
    total = sum(loads)
    if driver["maxPowerW"] is None:
        flag("WARN", "TotalWattage", f"MaxPower undeclared — {total:g}W assigned, not verified")
    else:
        if total > driver["maxPowerW"]:
            flag("FAIL", "TotalWattage",
                 f"total {total:g}W exceeds MaxPower {driver['maxPowerW']:g}W")
        if len(driver["nodes"]) == 1:
            for node_name, links in per_node.items():
                for l in links:
                    if l["loadW"] is not None and l["loadW"] > driver["maxPowerW"]:
                        flag("FAIL", "NoSplit",
                             f"{l['ref']} alone ({l['loadW']:g}W) exceeds MaxPower {driver['maxPowerW']:g}W on a 1CH driver",
                             node=node_name, link=l["ref"])

    # 3b. Per-node wattage cap (from Node Restrictions, independent of the driver total)
    for node in driver["nodes"]:
        cap = node.get("maxLoadW")
        links = per_node[node["name"]]
        if cap is None or not links:
            continue
        node_total = sum(l["loadW"] for l in links if l["loadW"] is not None)
        if node_total > cap:
            flag("FAIL", "NodeWattage",
                 f"node load {node_total:g}W exceeds node max {cap:g}W", node=node["name"])

    # 5. Series Forward Voltage
    for node in driver["nodes"]:
        links = per_node[node["name"]]
        if not links or node["maxFvV"] is None:
            continue
        fvs = [l["fvV"] for l in links]
        known = [v for v in fvs if v is not None]
        if len(known) < len(fvs):
            flag("WARN", "SeriesFV", "forward voltage missing on some links — fV not verified",
                 node=node["name"])
        if sum(known) > node["maxFvV"]:
            flag("FAIL", "SeriesFV",
                 f"series fV {sum(known):g} exceeds node max {node['maxFvV']:g}fV", node=node["name"])

    # 6. Current Match (CC only, 15% band — every correct CC node WARNs, expected)
    if driver["powerType"] == "CC":
        if driver["currentA"] is None:
            flag("WARN", "CurrentMatch", "current range undeclared — current not verified")
        else:
            for node_name, links in per_node.items():
                currents = [l["currentA"] for l in links if l["currentA"] is not None]
                if not currents:
                    if links:
                        flag("WARN", "CurrentMatch", "no link current data — current not verified",
                             node=node_name)
                    continue
                if max(currents) - min(currents) > 1e-6:
                    flag("MISMATCH", "CurrentMatch",
                         f"non-uniform link currents ({min(currents):g}–{max(currents):g}A) — mixed fixture types",
                         node=node_name)
                    continue
                delta = abs(currents[0] - driver["currentA"]) / driver["currentA"]
                if delta > CURRENT_TOLERANCE:
                    flag("MISMATCH", "CurrentMatch",
                         f"link current {currents[0]:g}A deviates {delta:.0%} from driver {driver['currentA']:g}A",
                         node=node_name)
                elif delta > 0:
                    flag("WARN", "CurrentMatch",
                         f"link current {currents[0]:g}A is {delta:.0%} off {driver['currentA']:g}A (expected input-power margin)",
                         node=node_name)

    # 7. ControlGroup uniformity
    for node_name, links in per_node.items():
        groups = sorted({l["controlGroup"] for l in links if l["controlGroup"]})
        if len(groups) > 1:
            flag("FAIL", "ControlGroup",
                 f"node serves multiple ControlGroups: {', '.join(groups)}", node=node_name)

    return flags


def validate(state, assignments, added_drivers):
    flags = []
    for driver in effective_drivers(state, added_drivers):
        flags.extend(validate_driver(state, assignments, driver))
    return flags


def fingerprint_compatible(link, driver):
    """Fill-independent rule-out: can this link EVER sit on this driver?

    Checks only intrinsic electrical fingerprint (CC/CV, CC current rating,
    CV output voltage) — not ControlGroup or capacity, which depend on fill.
    Undetermined drivers and unknown link types stay 'possible' (can't rule out).
    """
    if driver.get("undetermined"):
        return True
    if link["powerType"] and driver["powerType"] and link["powerType"] != driver["powerType"]:
        return False
    if driver["powerType"] == "CC" and link["currentA"] and driver["currentA"]:
        if abs(link["currentA"] - driver["currentA"]) / driver["currentA"] > CURRENT_TOLERANCE:
            return False
    if driver["powerType"] == "CV" and link["voltageV"] and driver["outputVoltageV"]:
        if abs(link["voltageV"] - driver["outputVoltageV"]) > 0.5:
            return False
    return True


def eligibility(state, zone, assignments, added_drivers):
    """Per-link placement picture for one zone, in a single pass.

    - nodesByLink[ref]  = ["driver|node", ...] nodes that would accept ref cleanly
    - impossibleByLink[ref] = [driverRef, ...] drivers ruled out by fingerprint

    Powers: dim-the-impossible (#1), fill-this-node by inversion (#3),
    target-count/forced-moves (#4), and orphan detection (#7).
    """
    drivers = [d for d in effective_drivers(state, added_drivers) if d["zone"] == zone]
    zone_links = [l for l in state["model"]["links"] if l["zone"] == zone]
    nodes_by_link = {}
    impossible_by_link = {}
    for link in zone_links:
        ref = link["ref"]
        nodes_by_link[ref] = [f"{t['driver']}|{t['node']}"
                              for t in suggest(state, ref, assignments, added_drivers)]
        impossible_by_link[ref] = [d["ref"] for d in drivers if not fingerprint_compatible(link, d)]
    return {"nodesByLink": nodes_by_link, "impossibleByLink": impossible_by_link}


def suggest(state, link_ref, assignments, added_drivers):
    """(driver, node) targets in the link's zone where dropping it adds no FAIL/MISMATCH."""
    link = state["links_by_ref"].get(link_ref)
    if not link:
        return []
    targets = []
    for driver in effective_drivers(state, added_drivers):
        if driver["zone"] != link["zone"]:
            continue
        for node in driver["nodes"]:
            key = f"{driver['ref']}|{node['name']}"
            entry = assignments.get(key) or {}
            if entry.get("refs") and entry.get("toEntityType") == "Position":
                continue  # ToEntityType uniformity
            trial = dict(assignments)
            # drop the link from wherever it currently sits
            for k, v in assignments.items():
                if v.get("refs") and link_ref in v["refs"]:
                    trial[k] = {**v, "refs": [r for r in v["refs"] if r != link_ref]}
            trial[key] = {"toEntityType": "Link",
                          "refs": (trial.get(key) or {}).get("refs", []) + [link_ref]}
            bad = [f for f in validate_driver(state, trial, driver)
                   if f["level"] in ("FAIL", "MISMATCH")]
            if not bad:
                targets.append({"driver": driver["ref"], "node": node["name"]})
    return targets
