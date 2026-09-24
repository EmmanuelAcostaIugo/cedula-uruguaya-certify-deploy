# Generar una oferta (QR) de Pre-Authorized Code

Este flujo lo dispara un operador (no hay todavía una pantalla de "self-service" para el
ciudadano) para emitir la credencial `CedulaUruguayaCredential` a una wallet Inji.

1. Armar el body con los datos de la persona (deben existir en `certify.cedula_uruguaya`,
   ver `certify_init.sql`):

   ```json
   {
     "credential_configuration_id": "CedulaUruguayaCredential",
     "claims": {
       "ci": "uy-ci-51234567",
       "given_name": "Sofía",
       "family_name_1": "García",
       "family_name_2": "Martínez",
       "birth_date": "1990-07-22",
       "nationality": "Uruguaya",
       "place_of_birth": "Montevideo, Uruguay",
       "document_type": "National ID",
       "document_number": "51234567",
       "issue_date": "2023-05-15",
       "expiry_date": "2033-05-14",
       "issuing_authority": "National Office of Civil Identification"
     },
     "expires_in": 3600
   }
   ```

2. Pedir la oferta:

   ```bash
   curl -s -X POST https://<tu-dominio>.duckdns.org/v1/certify/pre-authorized-data \
     -H "Content-Type: application/json" --data-binary @body.json
   ```

   Devuelve un `credential_offer_uri` (`openid-credential-offer://...`). La oferta y el código
   quedan cacheados 10 minutos (`mosip.certify.pre-auth.cache-expire-seconds`).

3. Convertir ese `credential_offer_uri` en un QR (cualquier librería, ej. `qrcode` de Python) y
   que la wallet (Inji Wallet) lo escanee.
