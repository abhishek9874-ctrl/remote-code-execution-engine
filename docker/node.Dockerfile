FROM node:22-alpine
RUN adduser -D -u 10001 sandbox && mkdir -p /sandbox && chown sandbox /sandbox
USER sandbox
WORKDIR /sandbox
