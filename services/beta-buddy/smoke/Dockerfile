FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir mypy==1.18.2
COPY . /trusted/buddy
COPY smoke/check.py /checks/check.py
COPY smoke/entrypoint.py /checks/entrypoint.py
USER 65534:65534
ENTRYPOINT ["python", "/checks/entrypoint.py"]
