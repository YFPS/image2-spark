from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "repair_generated_assets.py"
spec = importlib.util.spec_from_file_location("repair_generated_assets", SCRIPT_PATH)
repair_script = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = repair_script
spec.loader.exec_module(repair_script)


class RepairGeneratedAssetsScriptTests(unittest.TestCase):
    def test_stats_from_results_counts_each_repair_status(self):
        stats = repair_script.stats_from_results(
            [
                SimpleNamespace(status="repaired"),
                SimpleNamespace(status="valid"),
                SimpleNamespace(status="unavailable"),
                SimpleNamespace(status="skipped"),
                SimpleNamespace(status="unavailable"),
            ]
        )

        self.assertEqual(stats.checked, 5)
        self.assertEqual(stats.repaired, 1)
        self.assertEqual(stats.valid, 1)
        self.assertEqual(stats.unavailable, 2)
        self.assertEqual(stats.skipped, 1)


if __name__ == "__main__":
    unittest.main()
