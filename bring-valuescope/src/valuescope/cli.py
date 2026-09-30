"""CLI: analyse a deal JSON and print the result as JSON (or CSV).

    python -m valuescope.cli examples/sample_deal.json
    python -m valuescope.cli examples/sample_deal.json --csv
"""

from __future__ import annotations

import argparse
import json
import sys

from .engine.analyze import analyze
from .io_json import analysis_to_csv, deal_from_dict


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="valuescope", description="Analyse a deal JSON file")
    parser.add_argument("path", help="path to a deal JSON file")
    parser.add_argument("--csv", action="store_true", help="emit base metrics as CSV")
    args = parser.parse_args(argv)

    with open(args.path, encoding="utf-8") as fh:
        payload = json.load(fh)

    deal, data = deal_from_dict(payload)
    result = analyze(deal, data=data).to_dict()

    if args.csv:
        print(analysis_to_csv(result))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
