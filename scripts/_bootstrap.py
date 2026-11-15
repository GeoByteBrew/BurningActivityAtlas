# AI disclosure: written with the assistance of an AI tool (large language model). See AI_USE.md.
"""Make `src/` importable when scripts are run directly."""
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
