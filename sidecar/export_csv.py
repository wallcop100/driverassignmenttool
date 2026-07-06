"""Rebuild the DriverAssignmentForm CSV: original rows verbatim, changed rows
updated, added drivers appended as new rows. Re-importable as a resume file."""


def _quote(value):
    # match DataJoin style: non-empty fields quoted, empty fields bare
    if value is None or value == "":
        return ""
    return '"' + str(value).replace('"', '""') + '"'


def _derived_control_group(state, refs):
    groups = sorted({state["links_by_ref"][r]["controlGroup"]
                     for r in refs if r in state["links_by_ref"]
                     and state["links_by_ref"][r]["controlGroup"]})
    return ",".join(groups)


def export_csv(state, assignments, added_drivers):
    fieldnames = state["fieldnames"]
    baseline = state["model"]["baseline"]
    lines = [",".join(_quote(c) for c in fieldnames)]

    for row in state["original_rows"]:
        key = f"{row['ElementRef']}|{row['Node']}"
        entry = assignments.get(key)
        out = dict(row)
        if entry is not None and entry.get("refs", []) != baseline.get(key, {}).get("refs", []):
            refs = entry.get("refs") or []
            out["ToEntityRefs"] = ",".join(refs)
            out["ToEntityType"] = entry.get("toEntityType") or ("Link" if refs else "")
            out["ControlGroup"] = _derived_control_group(state, refs)
        lines.append(",".join(_quote(out.get(c)) for c in fieldnames))

    for added in added_drivers or []:
        template = state["inventory_by_type"].get(added["typeRef"])
        if not template:
            continue
        for node in template["nodes"]:
            key = f"{added['ref']}|{node['name']}"
            refs = (assignments.get(key) or {}).get("refs") or []
            row = {
                "Pullzone": added["zone"],
                "ParentElementRef": "",
                "ElementRef": added["ref"],
                "ElementTypeRef": added["typeRef"],
                "Driver Restrictions": template["driverRestrictions"],
                "Node Restrictions": template["nodeRestrictions"],
                "CurrentNodePowerInfo": "",
                "Node": node["name"],
                "ToEntityType": "Link" if refs else "",
                "ToEntityRefs": ",".join(refs),
                "ControlGroup": _derived_control_group(state, refs),
            }
            lines.append(",".join(_quote(row.get(c, "")) for c in fieldnames))

    return "\r\n".join(lines) + "\r\n"
