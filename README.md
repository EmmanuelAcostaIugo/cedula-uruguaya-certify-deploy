# cedula-uruguaya-certify-deploy

Despliegue mínimo (un solo EC2, sin RDS/ALB) de Inji Certify configurado para el caso de uso
"Cédula de Identidad Uruguaya" del hackathon, usando el flujo Pre-Authorized Code (OpenID4VCI).

No incluye mimoto ni inji-web (no se usan en este flujo) ni un verify-service propio (seguimos
usando el compartido `inji-verify.iugolabs.com`).

El frontend (`cedula-uruguaya-frontend`) NO va en este servidor: al ser un sitio estático, se
despliega gratis en Cloudflare Pages / GitHub Pages / Netlify apuntando directo al repo.

## Requisitos previos

1. Una cuenta gratuita en https://www.duckdns.org - creá un subdominio (ej. `cedula-uy.duckdns.org`)
   y guardá el token que te dan.
2. Una instancia EC2 Ubuntu 22.04 (t3.small o superior recomendado, 2GB+ RAM) con:
   - Security Group: puertos 22 (SSH, restringido a tu IP), 80 y 443 abiertos a `0.0.0.0/0`.
   - Elastic IP asociada (para que la IP no cambie al reiniciar la instancia).

## Uso

```bash
git clone https://github.com/EmmanuelAcostaIugo/cedula-uruguaya-certify-deploy.git
cd cedula-uruguaya-certify-deploy
cp .env.example .env
nano .env   # completar POSTGRES_PASSWORD, DUCKDNS_DOMAIN, DUCKDNS_TOKEN, LETSENCRYPT_EMAIL
sudo bash setup.sh
```

El script instala Docker, actualiza el DNS de DuckDNS, levanta Postgres + Certify + nginx,
obtiene el certificado real de Let's Encrypt y deja corriendo la renovación automática.

## Pasos manuales después del primer deploy

1. Publicar el DID nuevo (la instancia genera sus propias claves la primera vez):
   ```bash
   curl https://<tu-dominio>.duckdns.org/v1/certify/.well-known/did.json
   ```
   Copiar ese contenido al repo de GitHub Pages que sirve tu `did.json`.

2. Registrar el tipo de credencial (una sola vez):
   ```bash
   curl -X POST https://<tu-dominio>.duckdns.org/v1/certify/credential-configurations \
     -H "Content-Type: application/json" \
     --data-binary @config/cedula-uruguaya-credential-config.json
   ```

## Bug conocido: pérdida de claves en cada restart

Este build de `inji-certify-with-plugins:0.14.0` no persiste bien su PKCS12 keystore: si el
contenedor `certify` se reinicia (`docker compose restart certify` / recreate), suele fallar al
arrancar. El fix es resetear sus tablas de claves y dejar que las regenere desde cero (esto
invalida el DID publicado, hay que repetir el paso 1 de arriba):

```bash
docker compose exec database psql -U postgres -d inji_certify -c "delete from key_store; delete from key_alias;"
docker compose up -d --force-recreate certify
docker compose restart certify-nginx
```

## Generar una oferta Pre-Authorized Code (QR) para un ciudadano

Ver `docs/generar-oferta.md` (mismo flujo que se usó en desarrollo local).

## Smoke test end-to-end (`test-flow.js`)

`node test-flow.js` (requiere Node.js) hace todo el flujo Pre-Authorized Code contra
`https://certify-iugolabs.duckdns.org` en un solo proceso con conexión HTTP keep-alive: pide
la oferta, la canjea por un token, genera un proof `did:jwk` real y emite la credencial. Es
mucho más rápido que encadenar varios `curl` sueltos (cada proceso nuevo + handshake TLS
aparte puede hacer que se venza el `c_nonce`, que solo dura 40 segundos) - usarlo así evita
falsos negativos de "invalid_proof" por timing. Editar `preauth_body.json` para cambiar los
datos de prueba, y la constante `BASE` en `test-flow.js` si cambia el dominio.

## Notas de la primera puesta en producción (2026-09-25)

- **t3.micro no alcanza**: con Certify + Postgres + nginx + certbot juntos, el JVM entra en
  crash-loop por falta de RAM (914MB totales). Se subió a t3.small (2GB) - mínimo recomendado.
- **Contraseña de Postgres desincronizada**: `certify-default.properties` traía hardcodeado
  `spring.datasource.password=postgres`, pero el compose usa `${POSTGRES_PASSWORD}` para el
  contenedor de Postgres. Si cambiás `POSTGRES_PASSWORD` en `.env`, la property ya lee
  `${POSTGRES_PASSWORD:postgres}` (variable de entorno con fallback), y el compose ya pasa esa
  misma variable al servicio `certify` - no hace falta tocar nada más.
- **Reloj del cliente**: la validación del proof JWT usa clock skew cero
  (`setMaxClockSkew(0)`). Si el reloj de la máquina desde la que se prueba está desincronizado
  (ej. Windows con el servicio de hora parado), vas a ver `invalid_proof` sin pista alguna en
  los logs del servidor. Verificar con `w32tm /query /status` (Windows) antes de sospechar del
  servidor.
