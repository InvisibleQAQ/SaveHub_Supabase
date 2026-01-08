"""
Progress reporting abstraction for sync operations.

Decouples sync logic from transport mechanism (SSE, WebSocket, etc.).
"""

from enum import Enum
from typing import Any, Protocol, runtime_checkable


class SyncPhase(str, Enum):
    """Sync operation phases."""
    FETCHING = "fetching"
    FETCHED = "fetched"
    ANALYZING = "analyzing"
    SAVING = "saving"
    OPENRANK = "openrank"
    EMBEDDING = "embedding"
    DONE = "done"
    ERROR = "error"


@runtime_checkable
class ProgressReporter(Protocol):
    """
    Protocol for reporting sync progress.

    Implementations can target different transports:
    - SSE (Server-Sent Events)
    - WebSocket
    - Logging only
    """

    async def report_phase(self, phase: SyncPhase, **data: Any) -> None:
        """Report a phase transition with optional data."""
        ...

    async def report_error(self, message: str) -> None:
        """Report an error."""
        ...

    async def report_done(self, result: dict) -> None:
        """Report completion with final result."""
        ...
