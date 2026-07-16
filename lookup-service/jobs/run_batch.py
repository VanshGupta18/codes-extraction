"""CF worker entrypoint: rank all pending materials."""
import asyncio

import ranking_core


async def main() -> None:
    await ranking_core.build_index()
    if not ranking_core.get_index():
        raise SystemExit(f"Index not ready: {ranking_core.get_index_error()}")
    await ranking_core.run_batch_job()


if __name__ == "__main__":
    asyncio.run(main())
