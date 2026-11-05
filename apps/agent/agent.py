import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from apps.agent import runtime


if __name__ == "__main__":
    runtime.agents.cli.run_app(runtime.server)
