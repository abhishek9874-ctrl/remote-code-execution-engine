FROM alpine:3.20
RUN apk add --no-cache g++ musl-dev \
 && adduser -D -u 10001 sandbox \
 && mkdir -p /sandbox && chown sandbox /sandbox
USER sandbox
WORKDIR /sandbox
