# Security Policy

## Supported versions

Security fixes are currently provided for the latest `0.1.x` release only.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use [Paramission Lab's private vulnerability form](https://github.com/ParamissionLab/phantom/security/advisories/new) to submit a GitHub Security Advisory. Organization owners must enable Private Vulnerability Reporting after creating the repository. If it is not enabled yet, contact a Paramission Lab owner privately instead of posting report details publicly. Include:

- affected version and package entry point;
- reproduction steps or a minimal proof of concept;
- expected impact;
- relevant browser, Node.js, GPU, WASM, or worker configuration;
- any suggested mitigation.

Maintainers should acknowledge a complete report within seven days and provide a remediation status within fourteen days. Timelines may change based on severity and the involvement of upstream runtimes or model providers.

## Scope

Reports about unsafe buffer handling, cross-origin worker isolation, WebAssembly memory, GPU resource lifecycle, model loading, dependency integrity, and malformed image input are in scope. Model quality errors without a security impact should use the normal issue tracker.
