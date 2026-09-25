Put `oidckeystore.p12` in this folder before starting `mimoto-service` (not committed to git - see
`.gitignore`). Copy it from the local dev environment via `scp`, e.g.:

```
scp -i ~/.ssh/cedula-uruguaya-key.pem oidckeystore.p12 ubuntu@<server-ip>:cedula-uruguaya-certify-deploy/certs/
```
