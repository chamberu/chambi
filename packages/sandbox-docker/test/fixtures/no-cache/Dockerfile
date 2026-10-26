ARG BASE
FROM ${BASE}
# an image without /cache and without the workspace HOME (like node:24 or
# the old sandbox-node): Docker creates the mount points root-owned 0755,
# so the hardened mode needs the provider to open them
RUN rm -rf /cache /home/sandbox
