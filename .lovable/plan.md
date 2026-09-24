# Imágenes persistentes y ticket Bee Clean de 58 mm

## Objetivo
- Mantener visibles las imágenes de productos al salir y volver a Productos (prueba) o POS (prueba).
- Rediseñar el ticket térmico con el logo y los datos de Bee Clean, optimizado para papel de 58 mm y longitud automática.

## Cambios
1. Separar la obtención de productos de la renovación de enlaces privados de imagen, para que estos se regeneren cada vez que se abre una pantalla aunque los productos estén en memoria.
2. Añadir estados de carga y recuperación silenciosa cuando una imagen firmada expire o falle.
3. Crear un ticket monocromático y legible con logo, datos fiscales/contacto, folio, fecha, cliente, dirección, teléfono, detalle de productos, pago, descuento, total y mensaje final.
4. Configurar impresión real a 58 mm de ancho; la altura será automática para aprovechar el rollo de hasta 3276 mm sin espacios vacíos.
5. Incorporar el logo proporcionado a la aplicación y usar su símbolo como icono del navegador.
6. Validar compilación y comprobar visualmente Productos, POS y la vista previa del ticket.

## Detalles técnicos
- Las imágenes seguirán en almacenamiento privado y usarán enlaces temporales nuevos por pantalla.
- El ticket imprimirá en blanco y negro para máxima nitidez en impresora térmica.
- Los datos no disponibles del cliente se omitirán limpiamente en lugar de dejar espacios vacíos.
