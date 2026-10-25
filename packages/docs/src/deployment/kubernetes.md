# Kubernetes & Flux <Badge type="warning" text="Planned" />

::: warning Planned
The Helm chart and the template's Flux manifests do not exist yet.
:::

## Helm chart

One shared chart, published to an OCI registry and used by every agent app. Planned contents:

- **Deployment** with liveness (`/healthz`), readiness (`/readyz`) and startup probes, a long `terminationGracePeriodSeconds` (about 120 s) and a short `preStop` sleep, so the app fails readiness, drains and exits cleanly.
- **Service** and an optional **Ingress** for webhooks, the API and the UI.
- **`envFrom`** for one or more Secrets.
- Optional **CronJobs** for the one-shot `run-job` mode.
- When sandboxes are enabled: a **ServiceAccount and Role** for the sandbox pods (the verbs below), and a **NetworkPolicy** that limits sandbox egress to DNS, the npm registry and GitHub.
- An optional **ServiceMonitor** for Prometheus.

The values stay small: image, environment, Secrets, ingress, replicas, sandbox and cron jobs.

## Graceful shutdown

On `SIGTERM` the app fails readiness first, stops intake, then calls `engine.drain()` (which stops the channels, the cron schedule among them, first) within its budget. Runs still in progress are marked `interrupted` and recovered by another replica or the next pod. The drain deadline must be shorter than the grace period. This part already works in core: see [Cancel, Drain & Recovery](/guide/recovery#drain).

## Flux

Each agent repository gets:

- an `OCIRepository` for the chart and a `HelmRelease` with its values,
- an `ImageRepository` and an `ImagePolicy` that select the newest `main-<sha>-<timestamp>` tag (or a semver range),
- an image update marker in the `HelmRelease`, so Flux commits new tags back to the repository.

## Sandboxes in the cluster

[`@chamvi/sandbox-k8s`](/reference/sandbox#chamvi-sandbox-k8s) ships today; only the chart that wires it up is planned. Untrusted code runs in one bare pod per workspace (`chamvi-ws-<id>`):

- root (uid and gid 0) with a writable root filesystem, every capability dropped but `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `FSETID`, `SETUID`, `SETGID` and `KILL`, seccomp `RuntimeDefault`, no privilege escalation, not privileged; the hardened mode (`user: { uid: 1000, gid: 1000 }`, `readOnlyRoot: true`) runs non-root on a read-only root without any capability
- `automountServiceAccountToken: false`, `enableServiceLinks: false`, no chamvi Secrets or environment
- requests equal to limits for `cpu`, `memory` and `ephemeral-storage`; `/workspace` an emptyDir with a `sizeLimit`, `/tmp` a 1 GiB memory emptyDir (`tmpSize`), `/cache` the ReadWriteMany claim of `cache: { claimName }` shared by every workspace (else an emptyDir per pod) with the package-cache variables pointing into it; pids through the kubelet's `podPidsLimit`
- `restartPolicy: Never` and no `activeDeadlineSeconds`: a workspace pod lives as long as its run (through approval pauses and chamvi restarts) and is found again by label, up to the hard cap `limits.maxLifetimeMs` (7 days)
- labels `app.kubernetes.io/managed-by=chamvi`, `app.kubernetes.io/component=sandbox`, `chamvi.dev/run=<runId>`, `chamvi.dev/workspace=<id>` plus your `podLabels`; the expiry as the annotation `chamvi.dev/expires-at`

### Pod Security

The default pods run as root, which the Pod Security level `restricted` refuses; the capability set above is within `baseline`. Label the sandbox namespace `baseline`, never chamvi's own namespace:

```bash
kubectl label namespace agents-sandbox pod-security.kubernetes.io/enforce=baseline
```

Where a cluster allows only `restricted`, use the hardened mode: non-root with `runAsNonRoot` and `fsGroup`, a read-only root, no capability. `apt-get` then fails; toolchains still install into `/cache` with mise.

A shared cache claim is shared trust: a malicious package one run fetched can sit in another run's cache (npm verifies integrity hashes, pip and Go's build cache less). Leave `cache` unset, or use one claim per trust level, where runs must not influence each other.

Expired, failed and finished sandbox pods, and the pods of settled runs, are garbage-collected by the provider; each pod carries its `chamvi.dev/deployment` (`CHAMVI_DEPLOYMENT`), so deployments sharing a namespace leave each other's pods alone. Run the pods in their own namespace and give chamvi's service account this Role there:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: chamvi-sandbox
  namespace: agents-sandbox
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["create", "get", "list", "delete"]
  - apiGroups: [""]
    resources: ["pods/exec"]
    verbs: ["get", "create"]
```

`pods/exec` needs both `get` (the exec WebSocket opens with a GET) and `create` (API servers with the WebSocket-upgrade authorization change).

::: danger Not a network boundary yet
Without a NetworkPolicy a workspace pod reaches every service in the cluster, the chamvi API and its database included, and cloud metadata. Until the chart ships its policy, add one that selects `app.kubernetes.io/component=sandbox` and denies all egress except DNS, GitHub and the npm registry, with the chamvi namespace and `169.254.169.254` denied explicitly.
:::

A short-lived, narrowly scoped GitHub token for a sandbox that must push is planned.

## Replicas

See [Multiple Replicas](/deployment/replicas).
