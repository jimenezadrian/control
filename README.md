# Control Vianney y Tandas

Aplicación web (React + Vite + Supabase) para controlar ventas de productos Vianney, abonos, tandas, saldo de participantes y capital. Funciona en celular y computadora.

La base de datos **ya existe**: esta app no crea tablas ni ejecuta SQL.

## 1. Requisitos

- Node.js 18 o superior (https://nodejs.org)
- Una cuenta de Vercel o Netlify (para publicarla)

## 2. Configuración

1. Copia `.env.example` a `.env` (en la raíz del proyecto):
   ```
   VITE_SUPABASE_URL=https://cigcbnufiiagejjmaikj.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_jm2qmh2fMsztSAg-2SEdXw_f15H_8PE
   ```
2. No uses nunca la clave `service_role` en este proyecto.

## 3. Crear las dos cuentas (usted y Gaby)

En el panel de Supabase (https://supabase.com/dashboard):

1. **Desactiva el registro público**: *Authentication → Sign In / Providers* (o *Providers → Email*) → apaga **Allow new users to sign up** → guarda.
2. **Crea las cuentas manualmente**: *Authentication → Users → Add user → Create new user*. Escribe correo y contraseña, y marca **Auto Confirm User**. Repite para Gaby.
3. Usen esas credenciales en la pantalla de inicio de sesión de la app.

> Las tablas tienen una política que da acceso completo a **cualquier usuario autenticado**. Por eso este proyecto de Supabase debe usarse solo para esta app y con solo esas dos cuentas.

### Opcional: limitar el acceso a sus dos correos

Si quieren una capa extra, pueden reemplazar la política de cada tabla por una que solo permita sus dos correos. Esto **no es necesario** para empezar; revísenlo antes de ejecutarlo, porque modifica políticas existentes (`customers` como ejemplo, repetir por tabla):

```sql
-- Ejemplo: sustituye CORREO1 y CORREO2. Antes, borra la política actual de esa tabla.
create policy "solo_dos_usuarios" on public.customers
  for all to authenticated
  using ((auth.jwt() ->> 'email') in ('CORREO1', 'CORREO2'))
  with check ((auth.jwt() ->> 'email') in ('CORREO1', 'CORREO2'));
```

## 4. Ejecutar en la computadora

```bash
npm install
npm run dev
```

Abre la dirección que aparece (normalmente http://localhost:5173).

## 5. Publicar

### Vercel
1. Sube la carpeta a un repositorio de GitHub.
2. En vercel.com: **Add New → Project** → elige el repositorio (detecta Vite solo).
3. En **Environment Variables** agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. **Deploy**. Abre la dirección que te da desde el celular.

### Netlify
1. Sube la carpeta a GitHub y en netlify.com: **Add new site → Import an existing project**.
2. Build command: `npm run build` · Publish directory: `dist` (ya está en `netlify.toml`).
3. En **Site configuration → Environment variables** agrega las dos variables.
4. **Deploy**.

Tip: en el celular, abre la página y usa "Agregar a pantalla de inicio".

## 6. Cómo calcula la app

**Ventas**
- Utilidad esperada = precio de venta − costo ADI.
- El anticipo se guarda en `sales.deposit` y **también** como un pago en `payments`. Para lo pagado solo se suma `payments`, así no se duplica.
- Saldo pendiente = precio de venta − suma de pagos. No se permite abonar más de lo que se debe.
- Las columnas `payment_2_*` y `payment_3_*` de `sales` no se usan: los abonos se guardan en `payments`.

**Tandas**
- Saldo del participante = suma de aportaciones − suma de `balance_used` en sus compras.
- En una compra: `balance_used` = saldo de tanda usado (no puede pasar del saldo) y `extra_paid` = total − saldo usado. Lo pagado aparte no suma a las aportaciones.

**Capital**
- Invertido = Aportaciones − Recuperaciones.
- Utilidad ganada = por cada venta, lo cobrado que excede el costo ADI (la recuperación de capital no se cuenta como ganancia).
- Utilidad disponible = utilidad ganada − retiros de utilidad − gastos.
- Pendiente de cobrar = suma de saldos de ventas no liquidadas.
- Los movimientos de capital se registran a mano; no se enlazan automáticamente con ventas.

## 7. Notas y límites de esta versión

- La app carga hasta 5,000 registros por tabla (de sobra para un negocio familiar).
- Valores de texto como estado de la tanda (`Activa` / `Finalizada`) y frecuencia (`Semanal`, `Quincenal`, `Mensual`) son los que usa la app; si la base tuviera restricciones distintas, la app mostrará un error comprensible.
- Las ventas no se editan: si hay un error, se elimina y se vuelve a capturar.
- La creación de una venta con anticipo son dos escrituras (venta y pago); si falla la segunda, la app borra la venta para no dejar datos a medias.
