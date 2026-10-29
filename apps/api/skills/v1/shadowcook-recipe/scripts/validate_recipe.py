#!/usr/bin/env python3
"""Validate a portable Shadowcook recipe against its bundled schema and semantics."""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import SplitResult, urlsplit

from jsonschema import Draft7Validator, FormatChecker


def unique_keys(items: list[dict], label: str, errors: list[str]) -> dict[str, dict]:
    indexed: dict[str, dict] = {}
    for item in items:
        key: str = item["key"]
        if key in indexed:
            errors.append(f"Duplicate {label} key: {key}")
        indexed[key] = item
    return indexed


def safe_url(value: str, label: str, errors: list[str]) -> None:
    try:
        parsed: SplitResult = urlsplit(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            errors.append(f"{label} must be an HTTP(S) URL without credentials, query or fragment.")
    except ValueError:
        errors.append(f"{label} is not a valid HTTP(S) URL.")


def semantic_errors(document: dict) -> list[str]:
    errors: list[str] = []
    ingredients: dict[str, dict] = unique_keys(document["ingredients"], "ingredient", errors)
    units: dict[str, dict] = unique_keys(document["units"], "unit", errors)
    recipe: dict = document["recipe"]
    steps: dict[str, dict] = unique_keys(recipe["steps"], "step", errors)
    unique_keys(recipe["variants"], "variant", errors)
    references: dict[str, dict] = unique_keys(
        document.get("recipeReferences", []), "recipe reference", errors
    )
    all_entries: list[dict] = [entry for step in recipe["steps"] for entry in step["entries"]]
    unique_keys(all_entries, "entry", errors)
    for catalogue in (document["ingredients"], document["units"]):
        source_keys: set[tuple] = set()
        for entity in catalogue:
            if "source" not in entity:
                continue
            source: dict = entity["source"]
            identity: tuple = (
                source["instanceUrl"].rstrip("/"),
                source["tenantPublicId"].lower() if source["tenantPublicId"] else None,
                source["publicId"].lower(),
            )
            if identity in source_keys:
                errors.append("Source identities must be unique within each catalogue.")
            source_keys.add(identity)
    slugs: list[str] = [variant["slug"] for variant in recipe["variants"]]
    if len(slugs) != len(set(slugs)):
        errors.append("Variant slugs must be unique.")
    if sum(variant["isDefault"] for variant in recipe["variants"]) != 1:
        errors.append("Exactly one variant must be default.")

    step_positions: dict[str, int] = {key: index for index, key in enumerate(steps)}
    included: set[str] = set()
    for variant in recipe["variants"]:
        keys: list[str] = variant["includedStepKeys"]
        included.update(keys)
        if any(key not in steps for key in keys):
            errors.append(f"Variant {variant['key']} references an unknown step.")
        elif keys != sorted(keys, key=lambda key: step_positions[key]):
            errors.append(f"Variant {variant['key']} steps must follow global step order.")
    if set(steps) - included:
        errors.append("Every step must belong to at least one variant.")

    for entry in all_entries:
        if entry.get("ingredientKey") is not None:
            ingredient: dict | None = ingredients.get(entry["ingredientKey"])
            if ingredient is None:
                errors.append(f"Entry {entry['key']} references an unknown ingredient.")
            elif "alias" in entry and entry["alias"] not in ingredient.get("aliases", []):
                errors.append(f"Entry {entry['key']} selects an unknown ingredient alias.")
        if "unitKey" in entry and entry["unitKey"] not in units:
            errors.append(f"Entry {entry['key']} references an unknown unit.")

    for step in steps.values():
        for reference in re.findall(r"\{recipe:([^}]+)\}", step["instruction"]):
            if reference not in references:
                errors.append(f"Step {step['key']} references an unknown recipe: {reference}")

    metadata: dict = recipe.get("metadata", {})
    active: int | None = metadata.get("activeMinutes")
    total: int | None = metadata.get("totalMinutes")
    if active is not None and total is not None and active > total:
        errors.append("Active duration cannot exceed total duration.")
    if (
        len(document["ingredients"]) > 500
        or len(document["units"]) > 200
        or len(recipe["steps"]) > 500
        or len(recipe["variants"]) > 50
        or len(document.get("recipeReferences", [])) > 100
        or sum(len(step["entries"]) for step in recipe["steps"]) > 5000
    ):
        errors.append("The recipe exceeds the supported complexity.")
    sources: list[dict] = (
        list(ingredients.values()) + list(units.values()) + list(references.values())
    )
    if "provenance" in recipe:
        sources.append(recipe["provenance"])
    for entity in sources:
        if "source" in entity:
            safe_url(entity["source"]["instanceUrl"], "Source instance URL", errors)
    for reference in references.values():
        safe_url(reference["url"], f"Recipe reference {reference['key']} URL", errors)
    return errors


def reject_duplicate_properties(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON property: {key}")
        result[key] = value
    return result


def reject_nonfinite_constant(value: str) -> None:
    raise ValueError(f"Invalid JSON number: {value}")


def check_json_depth(contents: str) -> None:
    depth: int = 0
    in_string: bool = False
    escaped: bool = False
    for character in contents:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
        elif character == '"':
            in_string = True
        elif character in "[{":
            depth += 1
            if depth > 64:
                raise ValueError("The recipe JSON exceeds nesting depth 64.")
        elif character in "]}":
            depth -= 1


def validate(document: object, schema: dict) -> list[str]:
    validator: Draft7Validator = Draft7Validator(schema, format_checker=FormatChecker())
    structural: list[str] = [
        f"/{'/'.join(str(part) for part in error.absolute_path)}: {error.message}"
        for error in validator.iter_errors(document)
    ]
    if structural:
        return structural
    return semantic_errors(document)


def main() -> int:
    parser: argparse.ArgumentParser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", type=Path)
    arguments: argparse.Namespace = parser.parse_args()
    schema_path: Path = Path(__file__).resolve().parents[1] / "recipe.schema.json"
    try:
        schema: dict = json.loads(schema_path.read_text(encoding="utf-8"))
        Draft7Validator.check_schema(schema)
        contents: str = arguments.recipe.read_text(encoding="utf-8")
        if len(contents.encode("utf-8")) > 1_048_576:
            raise ValueError("The recipe JSON exceeds 1 MiB.")
        check_json_depth(contents)
        document: object = json.loads(
            contents,
            object_pairs_hook=reject_duplicate_properties,
            parse_constant=reject_nonfinite_constant,
        )
        errors: list[str] = validate(document, schema)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Valid Shadowcook recipe v1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
