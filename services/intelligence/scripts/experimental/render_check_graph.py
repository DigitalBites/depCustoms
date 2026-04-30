# ruff: noqa: E402
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.checks.embeddings import StubEmbeddingClient
from app.checks.graph import (
    GraphServices,
    NeighborSearcher,
    StubJudge,
    build_check_graph,
    get_check_graph_labels,
)
from app.core.config import Settings
from app.schemas import Neighbor

DEFAULT_OUTPUT_DIR = Path("docs/diagrams")
NATIVE_FILENAME = "check_graph.native.mmd"
CURATED_FILENAME = "check_graph.curated.mmd"
PNG_FILENAME = "check_graph.native.png"


class EmptySearcher(NeighborSearcher):
    def search(
        self,
        ecosystem: str,
        embedding: list[float],
        top_k: int,
    ) -> list[Neighbor]:
        del ecosystem, embedding, top_k
        return []


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render the LangGraph /check workflow as Mermaid.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory for generated Mermaid files.",
    )
    parser.add_argument(
        "--with-png",
        action="store_true",
        help="Also render a PNG from the native Mermaid graph.",
    )
    return parser


def build_stub_services() -> GraphServices:
    return GraphServices(
        embeddings=StubEmbeddingClient(),
        neighbor_searcher=EmptySearcher(),
        judge=StubJudge(similarity_high_threshold=0.97),
        settings=Settings(),
        source="stub",
    )


def render_native_mermaid() -> str:
    graph = build_check_graph(build_stub_services())
    return graph.get_graph().draw_mermaid()


def render_curated_mermaid() -> str:
    labels = get_check_graph_labels()
    nodes = labels["nodes"]
    exact_routes = labels["exact_match_routes"]
    search_routes = labels["search_routes"]
    return "\n".join(
        [
            "---",
            "title: Intelligence /check workflow",
            "---",
            "graph TD;",
            f"    start([start]) --> exact_match_lookup[{nodes['exact_match_lookup']}]",
            "",
            (
                "    exact_match_lookup -->|"
                f"{exact_routes['exact_pass']}| exact_pass[{nodes['exact_pass']}]"
            ),
            (
                "    exact_match_lookup -->|"
                f"{exact_routes['embed_query']}| embed_query[{nodes['embed_query']}]"
            ),
            "",
            (
                "    embed_query --> "
                f"candidate_search[{nodes['candidate_search']}]"
            ),
            "",
            (
                "    candidate_search -->|"
                f"{search_routes['pass_empty']}| pass_node[{nodes['pass']}]"
            ),
            (
                "    candidate_search -->|"
                f"{search_routes['pass_exact_top']}| pass_node"
            ),
            (
                "    candidate_search -->|"
                f"{search_routes['flag_without_judge']}| "
                f"flag_without_judge[{nodes['flag_without_judge']}]"
            ),
            (
                "    candidate_search -->|"
                f"{search_routes['judge']}| llm_judge[{nodes['llm_judge']}]"
            ),
            (
                "    candidate_search -->|"
                f"{search_routes['pass_default']}| pass_node"
            ),
            "",
            "    exact_pass --> done([end])",
            "    pass_node --> done",
            "    flag_without_judge --> done",
            "    llm_judge --> done",
            "",
        ]
    )


def main() -> int:
    args = build_parser().parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    native_path = output_dir / NATIVE_FILENAME
    curated_path = output_dir / CURATED_FILENAME

    native_mermaid = render_native_mermaid()
    curated_mermaid = render_curated_mermaid()
    native_path.write_text(native_mermaid, encoding="utf-8")
    curated_path.write_text(curated_mermaid, encoding="utf-8")

    if args.with_png:
        png_path = output_dir / PNG_FILENAME
        graph = build_check_graph(build_stub_services())
        png_bytes = graph.get_graph().draw_mermaid_png()
        png_path.write_bytes(png_bytes)
        print(f"wrote {png_path}")

    print(f"wrote {native_path}")
    print(f"wrote {curated_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
