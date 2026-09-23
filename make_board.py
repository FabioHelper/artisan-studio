#!/usr/bin/env python3
"""Render the governed board from PLAN.json + FINDINGS.json.

Standard library only, no dependencies, no network.

    python make_board.py                 # render board.html + board.fragment.html
    python make_board.py --check         # exit 1 if the output is stale (this is P10)
    python make_board.py --example       # render from the bundled example plan

Paths are overridable so this drops into any repo layout:

    python make_board.py --plan docs/PLAN.json --findings docs/FINDINGS.json \
                         --out docs/board.html --gate-src tests/

WIRING IT INTO YOUR GATE
    `--check` is the whole of check P10. Call it from your test suite and fail
    on a non-zero exit. That is what stops a published board drifting from the
    plan it claims to render.
"""
import argparse
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Both tokens are assembled at runtime rather than written as literals. This
# file searches a template that documents its own contract, so a literal here
# would be a second occurrence in the very text being searched. The first
# draft did exactly that and silently produced a corrupt board -- the JSON
# payload injected into an HTML comment, the stylesheet pushed into <body>.
# It still opened. It still looked almost right. See reference/DESIGN.md §8.
DATA_TOKEN = "__" + "BOARD_DATA" + "__"
SPLIT_TOKEN = "<!--__" + "HEAD_END" + "__-->"


# --------------------------------------------------------------------------
# landed -- the one idea the whole system rests on.
#
# "Has this work landed?" is answered by looking at the TREE, never by reading
# a status label. A node names a (file, symbol) marker and has landed if and
# only if that symbol is present in that file. A build with phases carries NO
# evidence of its own: its landed-ness is the CONJUNCTION of its phases', which
# is what stops one phase's marker reporting a whole build as finished.
# --------------------------------------------------------------------------
def landed(node_id, nodes, root="."):
    node = nodes[node_id]
    ev = node.get("evidence")
    if ev:
        path = os.path.join(root, ev["file"])
        if not os.path.exists(path):
            return False
        if ev.get("symbol") is None:
            return True
        try:
            with open(path, encoding="utf-8") as fh:
                return ev["symbol"] in fh.read()
        except (IsADirectoryError, PermissionError, UnicodeDecodeError):
            return False
    children = [n for n in nodes.values() if n.get("parent") == node_id]
    if not children:
        return False  # unevidenced and no phases -- cannot be landed
    return all(landed(c["id"], nodes, root) for c in children)


def guards_that_exist(gate_src):
    """Every guard id your gate actually contains.

    A guard a node promises but has not built renders dashed/amber; check P7
    fails on that the moment the node lands. Point --gate-src at the file or
    directory holding your tests.
    """
    if not gate_src or not os.path.exists(gate_src):
        return None  # unknown: the board renders every guard as solid
    blobs = []
    if os.path.isfile(gate_src):
        paths = [gate_src]
    else:
        paths = [os.path.join(dp, f) for dp, _, fs in os.walk(gate_src) for f in fs]
    for p in paths:
        try:
            with open(p, encoding="utf-8") as fh:
                blobs.append(fh.read())
        except (UnicodeDecodeError, PermissionError, OSError):
            continue
    return "\n".join(blobs)


def payload(plan, findings, gate_blob, root="."):
    nodes = {n["id"]: n for n in plan["nodes"]}

    out_nodes = []
    for nid, n in nodes.items():
        d = dict(n)
        d["landed"] = landed(nid, nodes, root)
        out_nodes.append(d)

    # NEXT prefers work already IN EXECUTION over work not yet started -- you
    # finish what you started. Getting this backwards is a real defect we
    # shipped and had to file: a resuming session was sent to a phase the owner
    # had explicitly deferred, because the first `approved` node won the search.
    def ready(n):
        return all(landed(d, nodes, root) for d in n.get("depends_on", []) if d in nodes)

    nxt = (next((n for n in nodes.values()
                 if n.get("intent") == "in_execution" and not landed(n["id"], nodes, root)), None)
           or next((n for n in nodes.values()
                    if n.get("intent") == "approved" and ready(n)), None))

    all_guards = {g for n in nodes.values() for g in (n.get("guard") or [])}
    built = sorted(all_guards) if gate_blob is None else sorted(
        g for g in all_guards if g in gate_blob)

    # A deterministic fingerprint, NEVER a wall clock. A timestamp would make
    # every regeneration produce different bytes and --check could never pass.
    stamp = hashlib.sha256(
        (json.dumps(plan, sort_keys=True) + json.dumps(findings, sort_keys=True)
         + open(os.path.join(HERE, "board.template.html"), encoding="utf-8").read()
         ).encode("utf-8")).hexdigest()[:12]

    return {
        "plan_version": plan.get("plan_version"),
        "generated_at": f"source fingerprint {stamp}",
        "mission": plan.get("mission", {}),
        "arcs": plan.get("arcs", []),
        "nodes": out_nodes,
        "findings": findings.get("findings", []),
        "built_guards": built,
        "next": nxt,
        "gate": {"failures": sum(len(f.get("expected_failures", []))
                                 for f in findings.get("findings", []))},
    }


def render(template, data, standalone=True):
    # Exactly once, or stop. A generated file that is silently wrong is worse
    # than one that fails to generate, because the board is what everyone else
    # trusts WITHOUT checking.
    for name, token in (("data placeholder", DATA_TOKEN), ("split marker", SPLIT_TOKEN)):
        n = template.count(token)
        if n != 1:
            raise SystemExit(
                f"template: expected exactly 1 {name}, found {n}. A second occurrence "
                "is almost always prose describing the token -- describe it in the "
                "template without spelling it out.")

    blob = json.dumps(data, indent=1, ensure_ascii=False)
    blob = blob.replace("</script", "<\\/script")  # the one way a payload escapes
    tpl = template.replace(DATA_TOKEN, blob)
    if not standalone:
        return tpl
    head, body = tpl.split(SPLIT_TOKEN, 1)
    return ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
            + head.rstrip() + "\n</head>\n<body>" + body.rstrip() + "\n</body>\n</html>\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", default="PLAN.json")
    ap.add_argument("--findings", default="FINDINGS.json")
    ap.add_argument("--template", default=os.path.join(HERE, "board.template.html"))
    ap.add_argument("--out", default="board.html")
    ap.add_argument("--fragment", default=None,
                    help="also write a wrapper-less rendering here (for an embed host)")
    ap.add_argument("--gate-src", default=None,
                    help="file or directory holding your tests, so unbuilt guards show as planned")
    ap.add_argument("--root", default=".", help="repo root that evidence paths are relative to")
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if --out is stale -- this is check P10")
    ap.add_argument("--example", action="store_true",
                    help="render from the bundled example plan instead of the repo's")
    a = ap.parse_args(argv)

    plan_path, find_path = a.plan, a.findings
    if a.example:
        plan_path = os.path.join(HERE, "PLAN.example.json")
        find_path = os.path.join(HERE, "FINDINGS.example.json")
    for p in (plan_path, find_path, a.template):
        if not os.path.exists(p):
            raise SystemExit(f"missing: {p}")

    plan = json.load(open(plan_path, encoding="utf-8"))
    findings = json.load(open(find_path, encoding="utf-8"))
    template = open(a.template, encoding="utf-8").read()
    data = payload(plan, findings, guards_that_exist(a.gate_src), a.root)
    html = render(template, data, standalone=True)

    if a.check:
        if not os.path.exists(a.out):
            print(f"P10 FAIL: {a.out} does not exist -- regenerate it")
            return 1
        current = open(a.out, encoding="utf-8").read()
        if current != html:
            print(f"P10 FAIL: {a.out} is STALE -- regenerate with: python {os.path.basename(__file__)}")
            return 1
        print(f"P10 ok: {a.out} matches PLAN.json + FINDINGS.json")
        return 0

    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(html)
    print(f"wrote {a.out} ({os.path.getsize(a.out):,} bytes)")
    if a.fragment:
        with open(a.fragment, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(render(template, data, standalone=False))
        print(f"wrote {a.fragment} ({os.path.getsize(a.fragment):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
