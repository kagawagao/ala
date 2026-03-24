FROM python:3.12-slim

# Install Poetry
RUN pip install --no-cache-dir poetry==2.3.2

WORKDIR /app

# Copy only dependency manifests first (layer caching)
COPY pyproject.toml poetry.lock ./

# Install production deps only (no dev group), don't create a venv inside container
RUN poetry config virtualenvs.create false \
    && poetry install --only main --no-interaction --no-ansi

# Pre-download the Perfetto trace_processor binary so it is available at
# runtime without requiring outbound network access from the container.
RUN python3 -c \
    "from perfetto.trace_processor.platform import PlatformDelegate; \
     PlatformDelegate().get_shell_path(None)" || true

COPY src/ ./src/

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "ala.main:app", "--host", "0.0.0.0", "--port", "8000"]
