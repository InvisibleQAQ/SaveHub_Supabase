"""
Custom exception classes for the application.

These exceptions are caught by global exception handlers in exception_handlers.py,
providing consistent error responses across all API endpoints.

Usage:
    from app.exceptions import NotFoundError, DuplicateError, ValidationError

    # In route handlers - just raise, no try-except needed
    raise NotFoundError("Feed")           # 404: "Feed not found"
    raise DuplicateError("feed URL")      # 409: "Duplicate feed URL"
    raise ValidationError("Invalid data") # 400: "Invalid data"
"""


class AppException(Exception):
    """
    Base exception class for application-level errors.

    All custom exceptions should inherit from this class.
    The global exception handler will catch these and return
    appropriate HTTP responses.

    Attributes:
        message: Human-readable error message
        status_code: HTTP status code to return
        error_code: Machine-readable error code for client handling
    """

    def __init__(
        self,
        message: str,
        status_code: int = 500,
        error_code: str | None = None,
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code or f"ERR_{status_code}"
        super().__init__(message)


class NotFoundError(AppException):
    """
    Resource not found (404).

    Usage:
        raise NotFoundError("Feed")  # "Feed not found"
        raise NotFoundError("Article")  # "Article not found"
    """

    def __init__(self, resource: str = "Resource"):
        super().__init__(
            message=f"{resource} not found",
            status_code=404,
            error_code="NOT_FOUND",
        )


class DuplicateError(AppException):
    """
    Duplicate resource conflict (409).

    Usage:
        raise DuplicateError("feed URL")  # "Duplicate feed URL"
        raise DuplicateError("folder name")  # "Duplicate folder name"
    """

    def __init__(self, resource: str = "Resource"):
        super().__init__(
            message=f"Duplicate {resource}",
            status_code=409,
            error_code="DUPLICATE",
        )


class ValidationError(AppException):
    """
    Validation error (400).

    Usage:
        raise ValidationError("Invalid config type")
        raise ValidationError("Missing required field")
    """

    def __init__(self, message: str):
        super().__init__(
            message=message,
            status_code=400,
            error_code="VALIDATION_ERROR",
        )


class ConfigurationError(AppException):
    """
    Configuration missing or invalid (400).

    Usage:
        raise ConfigurationError("chat", "API")  # "Please configure chat API first"
        raise ConfigurationError("GitHub", "token")  # "Please configure GitHub token first"
    """

    def __init__(self, config_name: str, config_type: str = "configuration"):
        super().__init__(
            message=f"Please configure {config_name} {config_type} first",
            status_code=400,
            error_code="CONFIGURATION_MISSING",
        )


class ExternalServiceError(AppException):
    """
    External service error (502).

    Usage:
        raise ExternalServiceError("GitHub API", "rate limit exceeded")
        raise ExternalServiceError("OpenAI API", "timeout")
    """

    def __init__(self, service: str, reason: str | None = None):
        message = f"{service} error"
        if reason:
            message = f"{service} error: {reason}"
        super().__init__(
            message=message,
            status_code=502,
            error_code="EXTERNAL_SERVICE_ERROR",
        )
