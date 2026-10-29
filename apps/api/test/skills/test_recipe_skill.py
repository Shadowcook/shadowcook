"""Behavioral checks for the downloadable recipe validator and its examples."""

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from importlib.machinery import ModuleSpec
from pathlib import Path
from typing import Any
from types import ModuleType


skill_root: Path = Path(__file__).resolve().parents[2] / "skills/v1/shadowcook-recipe"
validator_path: Path = skill_root / "scripts/validate_recipe.py"
spec: ModuleSpec | None = importlib.util.spec_from_file_location("recipe_validator", validator_path)
assert spec is not None and spec.loader is not None
validator: ModuleType = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)
schema: dict = json.loads((skill_root / "recipe.schema.json").read_text(encoding="utf-8"))


class RecipeValidatorTests(unittest.TestCase):
    def example(self, name: str = "simple") -> dict:
        return json.loads((skill_root / f"examples/{name}.json").read_text(encoding="utf-8"))

    def test_examples_and_known_source_identities(self) -> None:
        for name in ("simple", "variants"):
            with self.subTest(name=name):
                self.assertEqual(validator.validate(self.example(name), schema), [])
        document: dict = self.example()
        source: dict = {
            "instanceUrl": "https://source.example/cookbooks",
            "tenantPublicId": "e3bd70b2-9948-4c4f-ab37-b43b45643f95",
            "publicId": "a24214ed-6ad2-4927-b387-eab834d5a1aa",
        }
        document["ingredients"][0]["source"] = source
        document["units"][0]["source"] = {**source, "tenantPublicId": None}
        document["recipe"]["provenance"] = {
            "source": source,
            "lineagePublicId": "c5f83c04-157e-4d8e-9556-fca482e70c64",
        }
        document["recipeReferences"] = [{
            "key": "sauce",
            "title": "Sauce",
            "url": "https://source.example/recipes/sauce",
            "source": source,
        }]
        document["recipe"]["steps"][0]["instruction"] += " Serve with {recipe:sauce}."
        self.assertEqual(validator.validate(document, schema), [])

    def test_ambiguous_or_broken_documents_are_rejected(self) -> None:
        base: dict = self.example("variants")
        entry: tuple[str | int, ...] = ("recipe", "steps", 0, "entries", 0)
        first_variant: tuple[str | int, ...] = ("recipe", "variants", 0)
        second_variant: tuple[str | int, ...] = ("recipe", "variants", 1)
        cases: list[tuple[str, tuple[str | int, ...], object]] = [
            ("duplicate ingredient", ("ingredients",), [*base["ingredients"], base["ingredients"][0]]),
            (
                "duplicate entry across steps",
                ("recipe", "steps", 1, "entries"),
                [*base["recipe"]["steps"][1]["entries"], base["recipe"]["steps"][0]["entries"][0]],
            ),
            ("missing ingredient", (*entry, "ingredientKey"), "missing"),
            ("missing unit", (*entry, "unitKey"), "missing"),
            ("unknown alias", (*entry, "alias"), "Unknown alias"),
            ("two defaults", (*second_variant, "isDefault"), True),
            ("no default", (*first_variant, "isDefault"), False),
            ("hidden default", (*first_variant, "isVisible"), False),
            ("duplicate variant slug", (*second_variant, "slug"), "klassisch"),
            ("missing step", (*second_variant, "includedStepKeys"), ["prepare", "missing"]),
            (
                "step order",
                (*first_variant, "includedStepKeys"),
                ["simmer", "prepare", "serve"],
            ),
            (
                "orphan step",
                (*second_variant, "includedStepKeys"),
                ["prepare", "simmer", "serve"],
            ),
            ("unresolved recipe", ("recipe", "steps", 0, "instruction"), "See {recipe:unknown}."),
            ("duration mismatch", ("recipe", "metadata", "activeMinutes"), 31),
            ("numeric amount", (*entry, "amount"), 0.5),
            ("exponent amount", (*entry, "amount"), "1e3"),
            ("excess precision", (*entry, "amount"), "0.1234567890123"),
            ("mass offset", ("units", 0, "conversion", "baseOffset"), "5"),
            ("zero factor", ("units", 0, "conversion", "baseFactor"), "0"),
            ("special row with unit", ("recipe", "steps", 0, "entries", 2, "unitKey"), "g"),
            ("credential field", ("accessToken",), "secret"),
            (
                "credential in recipe URL",
                ("recipeReferences",),
                [{
                    "key": "sauce",
                    "title": "Sauce",
                    "url": "https://source.example/recipes/sauce?access_token=secret",
                }],
            ),
            (
                "credential in source URL",
                ("ingredients", 0, "source"),
                {
                    "instanceUrl": "https://user:secret@source.example",
                    "tenantPublicId": "e3bd70b2-9948-4c4f-ab37-b43b45643f95",
                    "publicId": "a24214ed-6ad2-4927-b387-eab834d5a1aa",
                },
            ),
        ]
        for label, path, replacement in cases:
            with self.subTest(case=label):
                document: dict = copy.deepcopy(base)
                target: Any = document
                for segment in path[:-1]:
                    target = target[segment]
                target[path[-1]] = replacement
                self.assertTrue(validator.validate(document, schema), label)

    def test_cli_exit_status_and_strict_json_parsing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="shadowcook-recipe-validator-") as directory:
            path: Path = Path(directory) / "recipe.json"
            for content, expected in (
                (json.dumps(self.example()), 0),
                ('{"format":"shadowcook-recipe","format":"other"}', 1),
                ('{"format":NaN}', 1),
                ('{"format":Infinity}', 1),
                ('{broken', 1),
            ):
                with self.subTest(content=content[:50]):
                    path.write_text(content, encoding="utf-8")
                    result: subprocess.CompletedProcess = subprocess.run(
                        [sys.executable, str(validator_path), str(path)],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertEqual(result.returncode, expected, result.stderr)


if __name__ == "__main__":
    unittest.main()
