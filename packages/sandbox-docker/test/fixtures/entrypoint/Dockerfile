ARG BASE
FROM ${BASE}
# an image whose entrypoint is a command, not an init (like a CLI image):
# the provider replaces it, so the workspace still sleeps and execs
ENTRYPOINT ["git"]
