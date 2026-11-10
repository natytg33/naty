# Rubor Shop: tienda de packs y objetos

Un solo servidor Node con: tienda (la maqueta), panel `/admin`, almacenamiento privado, vista previa borrosa generada en el servidor, descargas con enlace firmado (7 días, 30 descargas) y checkout.

## Probar en tu PC (Node 20.6+)
1. `npm install`
2. `cp .env.example .env` y cambia `ADMIN_PASS`
3. `npm start` → tienda en http://localhost:3000 y panel en http://localhost:3000/admin
4. En el panel sube un pack: una **portada** (visible) y los **archivos** (quedan privados; de las imágenes se generan miniaturas borrosas).
5. Con `DIGITAL_PROVIDER=mock` el pago de packs se aprueba gratis, para probar todo el flujo.

## Pagos
- **Objetos físicos:** Stripe Checkout (clave en `.env`). Crea un webhook a `TU_DOMINIO/webhook/stripe` con el evento `checkout.session.completed`. Antes de activar, confirma con tu procesador que acepta tu actividad y descríbela con honestidad.
- **Packs digitales:** Stripe y PayPal normalmente no los aceptan. Contrata un procesador adulto (CCBill, Segpay, Verotel…), y en `server.js` busca el comentario "AQUÍ": crea el cobro con su API enviando `orderId` y devuelve la URL de pago. Haz que su notificación llegue a `/webhook/digital` (ajusta la verificación de firma a su documentación) y ponga `DIGITAL_PROVIDER=nombre`.
- Packs y objetos se pagan por separado (cada tipo usa un procesador distinto).

## Publicar (VPS Ubuntu, ej. Hetzner, que tiene datacenters en la UE)
1. Instala Node 20+, `git`/sube la carpeta, `npm install --omit=dev`.
2. Ejecuta con `pm2 start "npm start" --name rubor`.
3. Nginx como proxy a `localhost:3000` y HTTPS gratis con certbot. Pon `BASE_URL=https://tudominio.com`.
4. Haz copias de seguridad de `shop.db` y `storage/private/`. Sin ellas pierdes ventas y archivos.
5. Revisa que tu hosting permita contenido adulto en su política de uso.

## No incluido todavía
- Verificación de edad real (hoy es solo un botón) y registro de identidad/consentimiento de cada persona que aparece en el contenido.
- Vista borrosa de videos (solo se generan de imágenes), marca de agua por comprador, edición/borrado de productos desde el panel, facturación e impuestos.
- Almacenamiento en la nube (R2/S3) para muchos videos pesados; ahora se guarda en el disco del servidor.
- No pude ejecutarlo ni probar pagos reales en mi entorno: haz una prueba completa antes de vender.
