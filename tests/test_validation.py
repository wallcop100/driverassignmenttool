import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "sidecar"))
import export_csv  # noqa: E402
import parsing  # noqa: E402
import validation  # noqa: E402

SAMPLES = Path(__file__).parent.parent / "sample-data"
FORM_CSV = next(SAMPLES.glob("*DJ101580*")).read_text(encoding="utf-8-sig")
LINKS_CSV = next(SAMPLES.glob("*DJ101585*")).read_text(encoding="utf-8-sig")


@pytest.fixture(scope="module")
def state():
    _, state = parsing.build_model(FORM_CSV, LINKS_CSV)
    return state


def baseline_assignments(state):
    return {k: dict(v) for k, v in state["model"]["baseline"].items()}


def test_parse_shapes(state):
    model = state["model"]
    assert len(model["zones"]) == 11
    assert len(model["links"]) == 212
    e50019 = state["drivers_by_ref"]["E50019"]
    assert e50019["powerType"] == "CC"
    assert e50019["maxPowerW"] == 50
    assert e50019["currentA"] == 0.3
    assert [n["maxFvV"] for n in e50019["nodes"]] == [55, 55]
    # FEED-PROV has blank restrictions -> undetermined
    assert any(d["undetermined"] for d in model["drivers"])


def test_baseline_has_no_fails(state):
    flags = validation.validate(state, baseline_assignments(state), [])
    fails = [f for f in flags if f["level"] == "FAIL"]
    assert fails == [], fails


def test_overfill_fails(state):
    a = baseline_assignments(state)
    # pile every HUB-A CC link onto one 50W driver node
    cc_links = [l["ref"] for l in state["model"]["links"]
                if l["zone"] == "HUB-A" and l["powerType"] == "CC"]
    a["E50019|OP.1"] = {"toEntityType": "Link", "refs": cc_links}
    flags = validation.validate(state, a, [])
    assert any(f["check"] == "TotalWattage" and f["level"] == "FAIL"
               and f["driver"] == "E50019" for f in flags)


def test_type_mismatch_flagged(state):
    a = baseline_assignments(state)
    cv_link = next(l["ref"] for l in state["model"]["links"] if l["powerType"] == "CV")
    a["E50019|OP.1"] = {"toEntityType": "Link", "refs": [cv_link]}
    flags = validation.validate(state, a, [])
    assert any(f["check"] == "TypeMatch" and f["level"] == "MISMATCH"
               and f["link"] == cv_link for f in flags)


def test_series_fv_overflow_fails(state):
    a = baseline_assignments(state)
    links = state["model"]["links"]
    with_fv = [l["ref"] for l in links if l["fvV"]]
    # stack fV links until past the 55fV node limit
    stack, total = [], 0.0
    for ref in with_fv:
        stack.append(ref)
        total += state["links_by_ref"][ref]["fvV"]
        if total > 55:
            break
    assert total > 55, "sample data has no fV links summing past 55 — extend fixture"
    a["E50019|OP.1"] = {"toEntityType": "Link", "refs": stack}
    flags = validation.validate(state, a, [])
    assert any(f["check"] == "SeriesFV" and f["level"] == "FAIL" for f in flags)


def test_control_group_split_fails(state):
    a = baseline_assignments(state)
    links = state["model"]["links"]
    by_group = {}
    for l in links:
        if l["zone"] == "HUB-A" and l["controlGroup"]:
            by_group.setdefault(l["controlGroup"], l["ref"])
    two = list(by_group.values())[:2]
    a["E50019|OP.1"] = {"toEntityType": "Link", "refs": two}
    flags = validation.validate(state, a, [])
    assert any(f["check"] == "ControlGroup" and f["level"] == "FAIL" for f in flags)


def test_suggest_respects_capacity(state):
    a = baseline_assignments(state)
    link = next(l for l in state["model"]["links"]
                if l["powerType"] == "CC" and l["zone"] == "HUB-A" and l["loadW"])
    targets = validation.suggest(state, link["ref"], a, [])
    for t in targets:
        d = state["drivers_by_ref"][t["driver"]]
        assert d["zone"] == "HUB-A"
        if d["powerType"]:
            assert d["powerType"] == "CC"


def test_added_driver_validates_and_exports(state):
    a = baseline_assignments(state)
    added = [{"ref": "E90001", "typeRef": "ET-CCR-D-300-2CH-01", "zone": "HUB-A"}]
    link = next(l["ref"] for l in state["model"]["links"]
                if l["powerType"] == "CC" and l["zone"] == "HUB-A")
    # pull it out of its baseline node first
    for k, v in a.items():
        if link in v["refs"]:
            a[k] = {**v, "refs": [r for r in v["refs"] if r != link]}
    a["E90001|OP.1"] = {"toEntityType": "Link", "refs": [link]}
    flags = validation.validate(state, a, added)
    assert not any(f["level"] == "FAIL" and f["driver"] == "E90001" for f in flags)
    csv_text = export_csv.export_csv(state, a, added)
    assert '"E90001"' in csv_text
    assert '"ET-CCR-D-300-2CH-01"' in csv_text.split("E90001")[1][:200]


def test_export_roundtrip_lossless(state):
    csv_text = export_csv.export_csv(state, baseline_assignments(state), [])
    model2, state2 = parsing.build_model(csv_text, LINKS_CSV)
    assert model2["baseline"] == state["model"]["baseline"]
    assert [d["ref"] for d in model2["drivers"]] == [d["ref"] for d in state["model"]["drivers"]]


def test_export_reflects_moves(state):
    a = baseline_assignments(state)
    src_key = next(k for k, v in a.items() if v["refs"])
    moved = a[src_key]["refs"][0]
    a[src_key] = {**a[src_key], "refs": a[src_key]["refs"][1:]}
    dst_key = next(k for k, v in a.items() if not v["refs"] and k != src_key)
    a[dst_key] = {"toEntityType": "Link", "refs": [moved]}
    model2, _ = parsing.build_model(export_csv.export_csv(state, a, []), LINKS_CSV)
    assert moved in model2["baseline"][dst_key]["refs"]
    assert moved not in model2["baseline"][src_key]["refs"]


def test_node_restrictions_parsing():
    assert parsing.parse_node_restrictions("25W | 55fV") == (25.0, 55.0)
    assert parsing.parse_node_restrictions("55fV") == (None, 55.0)
    assert parsing.parse_node_restrictions("25W") == (25.0, None)
    assert parsing.parse_node_restrictions("") == (None, None)


def test_per_node_watt_cap_fails(state):
    # synthesize a node watt cap the sample data doesn't carry
    driver = dict(state["drivers_by_ref"]["E50019"])
    driver["nodes"] = [{"name": "OP.1", "maxFvV": 55.0, "maxLoadW": 20.0},
                       {"name": "OP.2", "maxFvV": 55.0, "maxLoadW": 20.0}]
    cc = [l["ref"] for l in state["model"]["links"]
          if l["zone"] == "HUB-A" and l["powerType"] == "CC" and l["loadW"]][:3]
    a = {"E50019|OP.1": {"toEntityType": "Link", "refs": cc}}
    flags = validation.validate_driver(state, a, driver)
    assert any(f["check"] == "NodeWattage" and f["level"] == "FAIL" for f in flags), flags


def test_fingerprint_rules_out_wrong_type(state):
    cc_link = next(l for l in state["model"]["links"] if l["powerType"] == "CC")
    cv_driver = next(d for d in state["model"]["drivers"] if d["powerType"] == "CV")
    cc_driver = next(d for d in state["model"]["drivers"] if d["powerType"] == "CC")
    assert not validation.fingerprint_compatible(cc_link, cv_driver)
    assert validation.fingerprint_compatible(cc_link, cc_driver)


def test_eligibility_shapes(state):
    a = baseline_assignments(state)
    elig = validation.eligibility(state, "HUB-A", a, [])
    assert "nodesByLink" in elig and "impossibleByLink" in elig
    # every HUB-A link is represented
    zone_links = [l["ref"] for l in state["model"]["links"] if l["zone"] == "HUB-A"]
    assert set(elig["nodesByLink"]) == set(zone_links)
    # a CC link should list the zone's CV drivers as impossible
    cc = next(l for l in state["model"]["links"]
              if l["zone"] == "HUB-A" and l["powerType"] == "CC")
    cv_in_zone = [d["ref"] for d in state["model"]["drivers"]
                  if d["zone"] == "HUB-A" and d["powerType"] == "CV"]
    assert set(cv_in_zone).issubset(set(elig["impossibleByLink"][cc["ref"]]))


def test_malformed_csv_rejected():
    with pytest.raises(parsing.ParseError, match="missing column"):
        parsing.build_model("Foo,Bar\r\n1,2\r\n", LINKS_CSV)
    with pytest.raises(parsing.ParseError, match="missing column"):
        parsing.build_model(FORM_CSV, "Foo,Bar\r\n1,2\r\n")
