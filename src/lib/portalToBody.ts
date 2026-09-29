/**
 * portalToBody — mueve un nodo al final de `<body>`.
 *
 * Cualquier ancestro con `backdrop-filter`, `transform`, `filter` o `will-change`
 * se convierte en el bloque contenedor de sus descendientes `position: fixed`, y
 * además abre un nuevo contexto de apilamiento. Con eso, un panel `fixed` con
 * coordenadas de viewport termina descentrado y, sobre todo, se dibuja POR DEBAJO
 * de los paneles hermanos que tienen `z-index` mayor.
 *
 * Montándolo en `<body>` el `fixed` es real y el `z-index` compite en la raíz.
 *
 * Es la acción documentada en AGENTS.md para menús, popovers y desplegables.
 */
export function portalToBody(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
