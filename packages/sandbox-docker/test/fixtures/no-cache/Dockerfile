ARG BASE
FROM ${BASE}
# an image without /cache (like node:24 or the old sandbox-node): Docker
# creates the mount point root-owned 0755, so the hardened mode needs the
# provider to open it
RUN rm -rf /cache
