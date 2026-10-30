ARG BASE
FROM ${BASE}
# an image without an init (like python:3.13 or node:24): the container's
# command would be pid 1 and reap nothing, so the provider adds docker-init
ENTRYPOINT []
