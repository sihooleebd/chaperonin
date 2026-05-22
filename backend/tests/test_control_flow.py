"""Control-flow primitives: types, scopes, scheduler integration."""

import unittest

from chaperonin.types import Text, List, is_compatible
from chaperonin.control_nodes import CONTROL_KINDS, ControlSpec
from chaperonin.scopes import analyze_scopes, ScopeError
from chaperonin.scheduler import RunContext, run_pipeline


# ─── types ──────────────────────────────────────────────────────────────────

class TestTextBool(unittest.TestCase):
    def test_bool_name(self):
        self.assertEqual(Text.Bool.name, "Text.Bool")

    def test_bool_subtype_of_text(self):
        self.assertTrue(is_compatible("Text.Bool", "Text"))


class TestListNamespace(unittest.TestCase):
    def test_list_pdb_name(self):
        self.assertEqual(List.Structure.PDB.name, "List.Structure.PDB")

    def test_list_pdb_self_compat(self):
        self.assertTrue(is_compatible("List.Structure.PDB", "List.Structure.PDB"))

    def test_list_pdb_to_list_structure(self):
        self.assertTrue(is_compatible("List.Structure.PDB", "List.Structure"))

    def test_list_vs_scalar(self):
        self.assertFalse(is_compatible("List.Structure.PDB", "Structure.PDB"))
        self.assertFalse(is_compatible("Structure.PDB", "List.Structure.PDB"))

    def test_list_union(self):
        self.assertTrue(is_compatible(
            "List.Text.Float", "List.Text.Float | List.Text.Integer"
        ))


# ─── control-node registry ──────────────────────────────────────────────────

class TestControlRegistry(unittest.TestCase):
    def test_all_seven(self):
        self.assertEqual(set(CONTROL_KINDS), {
            "START_FOR", "END_FOR", "SAVE", "GET", "IF", "COMPARE", "SELECT",
        })

    def test_each_is_ControlSpec(self):
        for spec in CONTROL_KINDS.values():
            self.assertIsInstance(spec, ControlSpec)

    def test_if_has_value_condition_two_outputs(self):
        s = CONTROL_KINDS["IF"]
        self.assertEqual([i["id"] for i in s.inputs], ["value", "condition"])
        self.assertEqual([o["id"] for o in s.outputs], ["if_true", "if_false"])

    def test_compare_op_choices(self):
        op = next(p for p in CONTROL_KINDS["COMPARE"].params if p["id"] == "op")
        self.assertEqual(set(op["choices"]), {"lt", "le", "eq", "ne", "ge", "gt"})


# ─── scope analysis ─────────────────────────────────────────────────────────

def _payload(nodes=None, control_nodes=None, io_nodes=None, edges=None):
    return {
        "nodes": nodes or [],
        "control_nodes": control_nodes or [],
        "io_nodes": io_nodes or [],
        "edges": edges or [],
        "dsl": "",
    }


class TestScopes(unittest.TestCase):
    def test_root_only(self):
        p = _payload(
            nodes=[{"id": "a", "module_id": "X", "inputs": [], "outputs": []}],
            io_nodes=[{"id": "src", "type": "input-node", "data_type": "Structure.PDB"}],
            edges=[{"source": "src", "source_handle": "value",
                    "target": "a", "target_handle": "in"}],
        )
        scopes = analyze_scopes(p)
        self.assertEqual(scopes.scope_of["a"], "_root")
        self.assertEqual(scopes.loops, {})

    def test_simple_loop_body(self):
        p = _payload(
            control_nodes=[
                {"id": "sf", "kind": "START_FOR", "params": {}},
                {"id": "ef", "kind": "END_FOR", "params": {}},
            ],
            nodes=[
                {"id": "body", "module_id": "X", "inputs": [], "outputs": []},
                {"id": "outside", "module_id": "Y", "inputs": [], "outputs": []},
            ],
            edges=[
                {"source": "sf", "source_handle": "gate",
                 "target": "body", "target_handle": "in"},
                {"source": "body", "source_handle": "out",
                 "target": "ef", "target_handle": "body_out"},
                {"source": "sf", "source_handle": "gate",
                 "target": "ef", "target_handle": "paired_start"},
                {"source": "ef", "source_handle": "results",
                 "target": "outside", "target_handle": "in"},
            ],
        )
        scopes = analyze_scopes(p)
        self.assertEqual(scopes.scope_of["body"], "sf")
        self.assertEqual(scopes.scope_of["outside"], "_root")
        self.assertEqual(scopes.loops["sf"].end_id, "ef")
        self.assertEqual(scopes.loops["sf"].body, ["body"])

    def test_end_without_pair_raises(self):
        p = _payload(control_nodes=[{"id": "ef", "kind": "END_FOR", "params": {}}])
        with self.assertRaises(ScopeError):
            analyze_scopes(p)

    def test_nested_loop_rejected(self):
        p = _payload(
            control_nodes=[
                {"id": "sf1", "kind": "START_FOR", "params": {}},
                {"id": "ef1", "kind": "END_FOR", "params": {}},
                {"id": "sf2", "kind": "START_FOR", "params": {}},
                {"id": "ef2", "kind": "END_FOR", "params": {}},
            ],
            edges=[
                {"source": "sf1", "source_handle": "gate",
                 "target": "sf2", "target_handle": "count"},
                {"source": "sf1", "source_handle": "gate",
                 "target": "ef1", "target_handle": "paired_start"},
                {"source": "sf2", "source_handle": "gate",
                 "target": "ef2", "target_handle": "paired_start"},
                {"source": "ef2", "source_handle": "results",
                 "target": "ef1", "target_handle": "body_out"},
            ],
        )
        with self.assertRaises(ScopeError):
            analyze_scopes(p)


# ─── RunContext ─────────────────────────────────────────────────────────────

class TestRunContext(unittest.TestCase):
    def test_root_save_get(self):
        rc = RunContext()
        rc.save("k", 42)
        self.assertEqual(rc.get("k"), 42)

    def test_loop_accumulates_and_promotes(self):
        rc = RunContext()
        rc.push_scope("sf")
        rc.save("scores", 0.5)
        rc.save("scores", 0.6)
        rc.save("scores", 0.7)
        rc.pop_scope("sf")
        self.assertEqual(rc.get("scores"), [0.5, 0.6, 0.7])

    def test_inner_falls_back_to_outer(self):
        rc = RunContext()
        rc.save("x", "outer")
        rc.push_scope("sf")
        # Inside the loop, with no inner save, GET walks out to root scope.
        self.assertEqual(rc.get("x"), "outer")
        rc.pop_scope("sf")
        # Nothing was saved inside the loop → outer remains untouched.
        self.assertEqual(rc.get("x"), "outer")


# ─── end-to-end scheduler (no Docker — control-only graphs) ─────────────────

def _io(id_, dtype, value=None):
    out = {"id": id_, "type": "input-node", "var_name": id_, "label": id_,
           "data_type": dtype}
    if value is not None:
        out["value"] = value
    return out


class TestControlFlowScheduler(unittest.TestCase):
    def _drive(self, payload):
        events = []
        run_pipeline(payload, events.append, simulate=True, step_delay=0)
        return events

    def test_save_get_round_trip(self):
        # Chain: src -> save1 -> save2 (intermediate dep) -> get1 reads back.
        # The edge save1->save2 forces save1 to run first; get1 has a dep on
        # save2 (via an unused passthrough) so it runs last.
        payload = _payload(
            control_nodes=[
                {"id": "save1", "kind": "SAVE", "params": {"name": "x"}},
                {"id": "save2", "kind": "SAVE", "params": {"name": "y"}},
                {"id": "get1", "kind": "GET", "params": {"name": "x"}},
            ],
            io_nodes=[
                _io("src", "Text.Integer", value=42),
            ],
            edges=[
                {"source": "src", "source_handle": "value",
                 "target": "save1", "target_handle": "value"},
                {"source": "save1", "source_handle": "value",
                 "target": "save2", "target_handle": "value"},
                {"source": "save2", "source_handle": "value",
                 "target": "get1", "target_handle": "_chain"},
            ],
        )
        evs = self._drive(payload)
        self.assertEqual(evs[-1]["type"], "pipeline.done", evs)
        kinds = [(e["type"], e.get("nodeId")) for e in evs]
        self.assertIn(("node.done", "save1"), kinds)
        self.assertIn(("node.done", "get1"), kinds)

    def test_for_loop_accumulates_indices(self):
        payload = _payload(
            control_nodes=[
                {"id": "sf", "kind": "START_FOR", "params": {}},
                {"id": "save_i", "kind": "SAVE", "params": {"name": "indices"}},
                {"id": "ef", "kind": "END_FOR", "params": {}},
                {"id": "get_all", "kind": "GET", "params": {"name": "indices"}},
            ],
            io_nodes=[
                _io("count_in", "Text.Integer", value=3),
            ],
            edges=[
                {"source": "count_in", "source_handle": "value",
                 "target": "sf", "target_handle": "count"},
                {"source": "sf", "source_handle": "iter",
                 "target": "save_i", "target_handle": "value"},
                {"source": "sf", "source_handle": "gate",
                 "target": "ef", "target_handle": "paired_start"},
                {"source": "save_i", "source_handle": "value",
                 "target": "ef", "target_handle": "body_out"},
            ],
        )
        evs = self._drive(payload)
        self.assertEqual(evs[-1]["type"], "pipeline.done", evs)
        # save_i should fire 3 times (one per iteration)
        save_dones = [e for e in evs
                      if e["type"] == "node.done" and e.get("nodeId") == "save_i"]
        self.assertEqual(len(save_dones), 3)

    def test_compare_then_if_gates_downstream(self):
        payload = _payload(
            control_nodes=[
                {"id": "cmp", "kind": "COMPARE", "params": {"op": "lt"}},
                {"id": "ifn", "kind": "IF", "params": {}},
                {"id": "save_t", "kind": "SAVE", "params": {"name": "T"}},
                {"id": "save_f", "kind": "SAVE", "params": {"name": "F"}},
            ],
            io_nodes=[
                _io("a_in", "Text.Integer", value=5),
                _io("b_in", "Text.Integer", value=10),
                _io("payload_in", "Text.RawString", value="hi"),
            ],
            edges=[
                {"source": "a_in", "source_handle": "value",
                 "target": "cmp", "target_handle": "a"},
                {"source": "b_in", "source_handle": "value",
                 "target": "cmp", "target_handle": "b"},
                {"source": "cmp", "source_handle": "result",
                 "target": "ifn", "target_handle": "condition"},
                {"source": "payload_in", "source_handle": "value",
                 "target": "ifn", "target_handle": "value"},
                {"source": "ifn", "source_handle": "if_true",
                 "target": "save_t", "target_handle": "value"},
                {"source": "ifn", "source_handle": "if_false",
                 "target": "save_f", "target_handle": "value"},
            ],
        )
        evs = self._drive(payload)
        kinds = [(e["type"], e.get("nodeId")) for e in evs]
        self.assertEqual(evs[-1]["type"], "pipeline.done", evs)
        self.assertIn(("node.done", "save_t"), kinds)
        self.assertIn(("node.skipped", "save_f"), kinds)


if __name__ == "__main__":
    unittest.main()
