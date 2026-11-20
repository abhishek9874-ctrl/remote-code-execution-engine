FROM python:3.12-alpine
# Non-root user. Combined with --cap-drop ALL and a read-only rootfs, code
# that breaks out of the interpreter still has no privileges to use.
RUN adduser -D -u 10001 sandbox && mkdir -p /sandbox && chown sandbox /sandbox
USER sandbox
WORKDIR /sandbox
