# Deployment <Badge type="warning" text="Planned" />

::: warning Planned
The app and the CLI exist: [`@chamvi/app`](/guide/app) boots an agent repository from env and [`@chamvi/cli`](/reference/cli) runs it with `chamvi start`, draining on `SIGTERM`. The [base image](/deployment/docker) `ghcr.io/chamvi/node` exists too. The Helm chart and the template repository do not exist yet; these pages describe the planned setup so you can see where chamvi is going.
:::

The target workflow: agents live in their own GitHub repository, CI builds a Docker image, and Flux deploys it to your Kubernetes cluster. Every agent repository is an app with one or more agents, its own store connection, its own GitHub App and its own channels.

```
agent repo --push--> CI --image--> registry --Flux image automation--> HelmRelease --> cluster
                                                                            |
                                         OpenClaw --MCP--> app (/mcp) --hooks--> OpenClaw
                                         GitHub ---webhooks---> app (/channels/github) --comments--> GitHub
```

## Pieces

| Piece | Built as |
|---|---|
| [`@chamvi/app`](/reference/app) + [`@chamvi/cli`](/reference/cli) (exist) | `createApp({ agents, modules })` boots config, store, engine (with its channels) and HTTP in order and tears them down in reverse, draining on `SIGTERM`. The `chamvi` bin with `dev`, `build`, `start`, `run-job` and `migrate`. See [Apps & Modules](/guide/app) |
| [Base image](/deployment/docker) (exists) | `ghcr.io/chamvi/node`: Node 24 on Debian trixie slim, tini, uid 1000, `linux/amd64` and `linux/arm64`; agent repositories use a two-stage Dockerfile |
| [Helm chart](/deployment/kubernetes) | One shared OCI chart for every agent app; each repository gets a small `HelmRelease` |
| Template repository | A GitHub template with an example agent, Dockerfile, CI that builds and tags images for Flux, and example Flux manifests |

## Configuration

Configuration comes from [environment variables](/reference/app#environment), typically from Kubernetes Secrets: the database URL, the HTTP port, the default model and provider API keys (`CHAMVI_MODEL`, `CHAMVI_PROVIDER_<NAME>_*` or the bare `ANTHROPIC_API_KEY`, ...; only providers you declare, no gateway by default, see [Pick a Model](/guide/models); `chamvi start --check` checks them, the store and the agent folders in CI with the production or staging env), static API tokens for machine clients, and OpenClaw and GitHub settings. How the Secrets get into the cluster (plain Secrets, SOPS, External Secrets) is the cluster's choice.

## Observability

Planned: OpenTelemetry spans for runs and steps next to the AI SDK's own telemetry, Prometheus metrics from the HTTP app, and structured JSON logs.

## Read next

- [Docker Image](/deployment/docker)
- [Kubernetes & Flux](/deployment/kubernetes)
- [Multiple Replicas](/deployment/replicas)
- [OpenClaw](/deployment/openclaw)
- [GitHub App](/deployment/github-app)
