import { createDockerSandbox } from '@chamvi/sandbox-docker';
import { createKubernetesSandbox } from '@chamvi/sandbox-k8s';

export function docker() {
    // #region docker
    const provider = createDockerSandbox({
        // pin a digest in production
        image: 'ghcr.io/chamvi/sandbox-dev:trixie',
        // a bridge without inter-container traffic, firewalled from the host
        network: 'chamvi-sandbox',
        limits: {
            cpu: '2', 
            memory: '4Gi', 
            pids: 1024, 
        },
    });
    // #endregion docker
    return provider;
}

export function kubernetes() {
    // #region k8s
    // in-cluster service account or KUBECONFIG
    const provider = createKubernetesSandbox({
        namespace: 'agents-sandbox',
        podLabels: { 'example.com/egress': 'restricted' },
        limits: {
            cpu: '2', 
            memory: '4Gi', 
            storage: '8Gi', 
        },
    });
    // #endregion k8s
    return provider;
}
