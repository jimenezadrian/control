# Control Vianney y Tandas

Aplicación web (React + Vite + Supabase) para controlar ventas de productos Vianney (con productos y SKU), abonos, tandas colectivas, pedidos por entregar y capital. Funciona en celular y computadora.

## 1. Requisitos

- Node.js 20.19 o superior (https://nodejs.org)
- Una cuenta de Vercel o Netlify (para publicarla)

## 2. Actualizar la base de datos (obligatorio, una sola vez)

Esta versión agrega productos con SKU, periodos de tanda y la relación tanda ↔ venta. **No borra ni modifica tus datos**: solo agrega tablas, columnas y funciones.

En Supabase abre **SQL Editor → New query** y ejecuta, **en este orden** y uno por uno, el contenido de:

1. `supabase/migrations/001_productos_sku.sql`
2. `supabase/migrations/002_tandas_periodos.sql`
3. `supabase/migrations/003_ventas_tandas.sql`

Cada archivo dice arriba qué hace. Son seguros de repetir (si ya los ejecutaste, no duplican nada).

Qué pasa con lo que ya tenías:
- **Ventas anteriores**: cada una se convierte en una venta con 1 producto (su descripción y sus totales). Quedan como *por entregar*; márcalas como entregadas desde **Ventas → Por entregar**.
- **Tandas y aportaciones de la versión anterior**: se conservan en la base, pero la app ya no usa saldos individuales (`participant_purchases` y las aportaciones sin periodo). Una tanda anterior no tiene fechas: ábrela y pulsa **Generar fechas**.

Si la app muestra "Falta aplicar las actualizaciones de la base de datos", es que falta ejecutar alguna de estas migraciones.

## 3. Configuración

1. Copia `.env.example` a `.env`:
   ```
   VITE_SUPABASE_URL=https://cigcbnufiiagejjmaikj.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_jm2qmh2fMsztSAg-2SEdXw_f15H_8PE
   ```
2. No uses nunca la clave `service_role` en este proyecto.

## 4. Crear las dos cuentas

En el panel de Supabase (https://supabase.com/dashboard):

1. **Desactiva el registro público**: *Authentication → Sign In / Providers* (o *Providers → Email*) → apaga **Allow new users to sign up** → guarda.
2. **Crea las cuentas manualmente**: *Authentication → Users → Add user → Create new user*. Escribe correo y contraseña, y marca **Auto Confirm User**. Repite para la segunda persona.

> Las tablas tienen una política que da acceso completo a **cualquier usuario autenticado** (las tablas nuevas usan la misma). Por eso este proyecto de Supabase debe usarse solo para esta app y con solo esas dos cuentas.

### Opcional: limitar el acceso a dos correos

Reemplaza la política de cada tabla (repetir por tabla: `customers`, `sales`, `sale_items`, `payments`, `savings_groups`, `savings_periods`, `participants`, `contributions`, `participant_purchases`, `capital_movements`). Revísalo antes de ejecutarlo, porque cambia políticas existentes:

```sql
-- Ejemplo con customers; sustituye CORREO1 y CORREO2 y borra antes la política actual de la tabla.
create policy "solo_dos_usuarios" on public.customers
  for all to authenticated
  using ((auth.jwt() ->> 'email') in ('CORREO1', 'CORREO2'))
  with check ((auth.jwt() ->> 'email') in ('CORREO1', 'CORREO2'));
```

## 5. Ejecutar en la computadora

```bash
npm install
npm run dev
```

Abre la dirección que aparece (normalmente http://localhost:5173).

## 6. Publicar

### Vercel
1. Sube la carpeta a un repositorio de GitHub.
2. En vercel.com: **Add New → Project** → elige el repositorio (detecta Vite solo).
3. En **Environment Variables** agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. **Deploy**.

### Netlify
1. Sube la carpeta a GitHub y en netlify.com: **Add new site → Import an existing project**.
2. Build command: `npm run build` · Publish directory: `dist` (ya está en `netlify.toml`).
3. En **Site configuration → Environment variables** agrega las dos variables.
4. **Deploy**.

Tip: en el celular abre la página y usa "Agregar a pantalla de inicio".

## 7. Cómo funciona

### Ventas con productos
- Una venta tiene uno o varios productos: nombre, SKU, cantidad, costo ADI unitario y precio unitario. Los totales de costo, venta y utilidad se calculan solos (`sales.adi_cost` y `sales.sale_price` se mantienen como totales para no romper nada).
- Utilidad esperada = precio de venta − costo ADI. Saldo = precio − pagos.
- El anticipo se guarda en `sales.deposit` y **también** como un pago en `payments`; solo se suma `payments`, así no se duplica.
- **Ventas → Por entregar** lista los productos pendientes por cliente, con SKU, estado de pago y fecha. Se puede buscar por SKU al recibir mercancía y marcar cada producto como entregado.
- La venta se crea en una sola transacción (función `create_sale`): si algo falla no queda nada a medias.

### Tandas (colectivas)
- Al crear una tanda se indican participantes, aportación por persona, número de fechas, frecuencia y fecha de inicio; las fechas se generan solas.
- En cada fecha todos aportan el mismo importe. Dentro de la fecha, **Marcar pagado** registra el importe configurado y la fecha real del pago con un clic; **Corregir** quita un pago marcado por error.
- Se ve cuántos han pagado (por ejemplo 8 de 10), lo recaudado, cuánto falta para completar la bolsa y el historial de pagos de cada participante.
- Ya no existen saldos individuales: cada fecha tiene una **bolsa común** que financia el pedido de quien tiene el turno.

### Pedido del turno: bolsa vs. precio de venta
Al pulsar **Registrar pedido del turno** se crea una venta normal (con varios productos) ligada a la tanda, a la fecha y al participante. La bolsa se aplica a esa venta como **un solo pago** marcado "Bolsa de tanda" (así el dinero se cuenta una vez). Lo aplicado es el **menor** entre la bolsa y el precio:

| Caso | Qué pasa |
|---|---|
| Bolsa = precio | La venta queda pagada. |
| **Precio mayor que la bolsa** (bolsa $1,000, pedido $1,200) | Se aplica toda la bolsa y los $200 de diferencia quedan como **saldo del participante** (abonos normales). No es dinero de la tanda. |
| **Precio menor que la bolsa** (bolsa $1,000, pedido $800) | Se aplican $800. Los $200 de **excedente no son utilidad**; al registrar el pedido hay que elegir: **devolverlos al participante** o **pasarlos a la bolsa de la siguiente fecha**. En la última fecha solo se pueden devolver. |

La utilidad siempre sale de la venta (precio − costo ADI), nunca de las aportaciones.

Reglas de seguridad: un periodo financia un solo pedido; no se corrige un pago de un periodo ya financiado (primero se elimina su venta); no se puede eliminar una venta cuyo excedente ya se usó en el pedido siguiente.
Si alguien paga **después** de que su fecha ya financió un pedido, ese dinero queda en resguardo y se muestra como "sin aplicar" en esa fecha.

### Dashboard y capital
- Aportaciones de tandas ≠ ingreso ≠ utilidad. Solo cuentan como cobrado cuando la bolsa se aplica a un pedido.
- Ventas normales y de tandas se suman como ventas; se muestra por separado la utilidad de las ventas de tandas.
- Capital pendiente de recuperar = aportaciones − recuperaciones de capital propio.
- Utilidad obtenida = por cada venta, lo cobrado que excede su costo ADI. Utilidad disponible = obtenida − retiros − gastos.
- "Dinero de tandas en resguardo" = aportaciones − bolsa aplicada − excedentes devueltos (dinero de los participantes, no del negocio).
- Los movimientos de capital se registran a mano; no se enlazan automáticamente con ventas.

## 8. Notas y límites

- La app carga hasta 5,000 registros por tabla (de sobra para un negocio familiar).
- Los textos `Activa` / `Finalizada` (tanda) y `Semanal` / `Quincenal` / `Mensual` son los que usa la app.
- Las ventas no se editan: si hay un error se elimina la venta y se vuelve a capturar (los productos sí se pueden marcar como entregados).
- Las migraciones se probaron en un PostgreSQL local con un esquema que simula el original; conviene hacer una primera prueba en tu Supabase con datos de ejemplo.
